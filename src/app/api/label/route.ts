import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { NextResponse } from "next/server";
import { callerKey, consumeImageQuota } from "@/lib/imageQuota";
import {
  LABELING_MODEL,
  MAX_IMAGES_PER_REQUEST,
  MAX_IMAGES_PER_RUN,
  MONTHLY_LABEL_ALLOWANCE,
  UNCLEAR_LABEL,
  correlateLabels,
  type LabelRequestBody,
  type LabelResult,
} from "@/lib/labeling";

// Availability depends on an environment variable read at request time, so this
// must never be cached into a static response.
export const dynamic = "force-dynamic";

const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Enough for 12 short verdicts; a truncated array is treated as a failed batch. */
const MAX_TOKENS = 2048;

function accountsConfigured() {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function GET() {
  return NextResponse.json({
    // Accounts are part of availability now, not a separate concern: without
    // them there is no durable way to meter this, and an unmetered route
    // spends the site owner's Anthropic key on anyone who finds it.
    available: !!process.env.ANTHROPIC_API_KEY && accountsConfigured(),
    model: LABELING_MODEL,
    maxImagesPerRequest: MAX_IMAGES_PER_REQUEST,
    maxImagesPerRun: MAX_IMAGES_PER_RUN,
    monthlyAllowance: MONTHLY_LABEL_ALLOWANCE,
  });
}

/**
 * Spends the caller's monthly allowance, or says why not.
 *
 * The token is checked by the database rather than here: PostgREST verifies
 * the JWT, and the function reads auth.uid() from it, so a forged or expired
 * token can't spend anyone's allowance. One round trip answers both "are they
 * signed in" and "have they got any left".
 */
async function spendAllowance(
  token: string,
  images: number,
): Promise<{ ok: true; remaining: number } | { ok: false; status: number; error: string }> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );

  const { data, error } = await supabase.rpc("consume_label_quota", { p_images: images });

  if (error) {
    // 42501 is the function refusing an unauthenticated caller; PostgREST
    // answers PGRST301 for a token that is expired or malformed.
    if (error.code === "42501" || error.code === "PGRST301") {
      return { ok: false, status: 401, error: "Sign in to use AI labelling." };
    }
    if (error.code === "P0001") {
      return {
        ok: false,
        status: 429,
        error: `That's this month's labelling allowance of ${MONTHLY_LABEL_ALLOWANCE} photos used up. It resets on the 1st, and you can still label by hand.`,
      };
    }
    return { ok: false, status: 502, error: "Couldn't check your labelling allowance." };
  }

  return { ok: true, remaining: typeof data === "number" ? data : 0 };
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI labelling is not configured on this deployment." },
      { status: 503 },
    );
  }

  let body: LabelRequestBody;
  try {
    body = (await request.json()) as LabelRequestBody;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const invalid = validate(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  if (!accountsConfigured()) {
    return NextResponse.json(
      { error: "AI labelling needs accounts configured on this deployment." },
      { status: 503 },
    );
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Sign in to use AI labelling." }, { status: 401 });
  }

  // Still per-IP first, and still only in memory. It is no longer the thing
  // standing between a stranger and the API key, just a cheap way to stop a
  // burst before it reaches the database or Anthropic.
  const quota = consumeImageQuota(callerKey(request.headers), body.images.length);
  if (!quota.ok) {
    return NextResponse.json(
      {
        error: `Labelling limit reached. Try again in about ${Math.ceil(
          quota.retryAfterSeconds / 60,
        )} minutes.`,
      },
      { status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds) } },
    );
  }

  const allowance = await spendAllowance(token, body.images.length);
  if (!allowance.ok) {
    return NextResponse.json({ error: allowance.error }, { status: allowance.status });
  }

  // Constructed per request, not at module scope: a missing key then can't
  // throw at import time and take the whole route down.
  const client = new Anthropic({ apiKey });

  try {
    const results = await labelBatch(client, body);
    return NextResponse.json({ results, remaining: allowance.remaining });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "The configured Anthropic API key was rejected." },
        { status: 502 },
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Anthropic rate limit hit. Try again shortly." },
        { status: 429 },
      );
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: "The labelling service failed." }, { status: 502 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Labelling failed." },
      { status: 502 },
    );
  }
}

function validate(body: LabelRequestBody): string | null {
  if (!body || typeof body !== "object") return "Malformed request body.";
  if (!Array.isArray(body.classes) || body.classes.length < 2) return "At least two groups are required.";
  if (!Array.isArray(body.images) || body.images.length === 0) return "No images supplied.";
  if (body.images.length > MAX_IMAGES_PER_REQUEST) {
    return `At most ${MAX_IMAGES_PER_REQUEST} images per request.`;
  }
  const classIds = new Set(body.classes.map((c) => c.id));
  for (const image of body.images) {
    if (typeof image.id !== "string" || typeof image.data !== "string" || !image.data) {
      return "An image entry was malformed.";
    }
    if (!ALLOWED_MEDIA_TYPES.has(image.mediaType)) return "Unsupported image type.";
    if (!classIds.has(image.classId)) return "An image referenced an unknown group.";
  }
  return null;
}

async function labelBatch(client: Anthropic, body: LabelRequestBody): Promise<LabelResult[]> {
  // Stable synthetic labels rather than the user's own group names. Names are
  // free text, they can collide when cased differently, contain emoji, or be
  // renamed mid-run, and none of that should reach the model as an identifier.
  const slugs = body.classes.map((_, i) => `group_${i + 1}`);
  const slugToClassId = new Map(slugs.map((slug, i) => [slug, body.classes[i].id]));
  // `slugs` always has at least two entries (validate() enforces two groups),
  // but the tuple type z.enum wants can't be inferred from a mapped array.
  const allowed: [string, ...string[]] = [UNCLEAR_LABEL, ...slugs];

  const Schema = z.object({
    labels: z.array(
      z.object({
        image: z.number().int().describe("The image number it was shown as."),
        group: z.enum(allowed),
        confidence: z.number().min(0).max(1),
        note: z
          .string()
          .describe("What you actually see, at most 12 words."),
      }),
    ),
  });

  const roster = body.classes.map((c, i) => `- ${slugs[i]}, "${c.name}"`).join("\n");
  const system = [
    "You are helping someone sort photos they captured to train a small custom image detector.",
    "",
    `What they want it to notice: "${body.description || "(not described)"}"`,
    "",
    "The groups, and the label to use for each:",
    roster,
    `- ${UNCLEAR_LABEL}, the photo is blurry, empty, ambiguous, or fits none of the groups`,
    "",
    "For every image you are shown, return one entry with that image's number, the label of",
    "the group it belongs in, your own 0-1 confidence, and a note of at most 12 words saying",
    "what you actually see. Return exactly one entry per image and no extra entries.",
  ].join("\n");

  const content: Anthropic.ContentBlockParam[] = [];
  body.images.forEach((image, i) => {
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType as "image/jpeg" | "image/png" | "image/webp",
        data: image.data,
      },
    });
  });

  // No `thinking` and no `output_config.effort`: this is a classification, and
  // Haiku 4.5 rejects effort outright.
  const response = await client.messages.parse({
    model: LABELING_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(Schema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to label these photos.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The labelling response was cut short.");
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("The labelling response could not be read.");

  return correlateLabels(parsed.labels, body.images, slugToClassId);
}
