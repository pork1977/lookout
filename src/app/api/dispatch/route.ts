import { NextResponse } from "next/server";
import { callerKey, consumeDispatchQuota } from "@/lib/imageQuota";
import { checkOutboundUrl } from "@/lib/safeUrl";

export const dynamic = "force-dynamic";

/**
 * Anything that has to leave the browser comes through here.
 *
 * Two reasons it can't be done client-side: a webhook URL is effectively a
 * secret and would be visible in the page, and CORS blocks most of these
 * endpoints from a browser anyway.
 */

const TIMEOUT_MS = 8000;
const MAX_MESSAGE = 500;

export type DispatchAction = "slack" | "discord" | "webhook" | "email";

interface DispatchBody {
  action: DispatchAction;
  /** Webhook URL, or an email address for the email action. */
  target: string;
  message: string;
  detectorName?: string;
  className?: string;
  confidence?: number;
}

export function GET() {
  return NextResponse.json({
    webhooks: true,
    // Email needs a provider; the others only need the user's own URL.
    email: !!process.env.RESEND_API_KEY,
  });
}

export async function POST(request: Request) {
  let body: DispatchBody;
  try {
    body = (await request.json()) as DispatchBody;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (!body?.action || typeof body.target !== "string" || typeof body.message !== "string") {
    return NextResponse.json({ error: "Missing action, target or message." }, { status: 400 });
  }
  if (body.message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: "That message is too long." }, { status: 400 });
  }

  const quota = consumeDispatchQuota(callerKey(request.headers));
  if (!quota.ok) {
    return NextResponse.json(
      { error: "Too many alerts in a short window. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds) } },
    );
  }

  try {
    switch (body.action) {
      case "slack":
        return await postJson(body.target, { text: body.message });
      case "discord":
        return await postJson(body.target, { content: body.message });
      case "webhook":
        return await postJson(body.target, {
          detector: body.detectorName ?? null,
          sawClass: body.className ?? null,
          confidence: body.confidence ?? null,
          message: body.message,
          firedAt: new Date().toISOString(),
        });
      case "email":
        return await sendEmail(body);
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dispatch failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function postJson(target: string, payload: unknown) {
  const check = await checkOutboundUrl(target);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      // Not "follow": a redirect is the standard way around an address check,
      // and the destination of a 302 was never validated.
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json(
        { error: "That endpoint redirected, which isn't followed for safety." },
        { status: 400 },
      );
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: `The endpoint replied ${response.status}.` },
        { status: 502 },
      );
    }
    // The response body is deliberately not read or returned: it is attacker-
    // influenced content from an address the user chose, and echoing it back
    // would turn a blocked read into a working one.
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return NextResponse.json({ error: "That endpoint timed out." }, { status: 504 });
    }
    return NextResponse.json({ error: "Couldn't reach that endpoint." }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmail(body: DispatchBody) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Email isn't configured on this deployment." },
      { status: 503 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.target)) {
    return NextResponse.json({ error: "That doesn't look like an email address." }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "Lookout <onboarding@resend.dev>",
        to: [body.target],
        subject: body.detectorName ? `${body.detectorName} saw something` : "Lookout alert",
        text: body.message,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return NextResponse.json({ error: "The email provider rejected that." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the email provider." }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
