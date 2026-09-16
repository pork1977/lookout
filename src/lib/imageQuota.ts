/**
 * Counts *images*, not requests, so the ceiling is on what actually costs
 * money rather than on how the client chooses to batch it.
 *
 * Honest about what this is: module scope on a serverless platform is
 * per-instance, so this slows abuse rather than hard-capping it globally.
 * The durable version is the Upstash Redis limiter documented in
 * .env.example; this is the fallback that file describes.
 */
const WINDOW_MS = 10 * 60 * 1000;
const IMAGES_PER_WINDOW = 300;

interface Bucket {
  used: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function prune(now: number) {
  // Bounded cleanup: without it a long-lived instance accumulates a bucket per
  // IP that ever called the route.
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface QuotaDecision {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function consumeImageQuota(key: string, images: number): QuotaDecision {
  const now = Date.now();
  prune(now);

  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now ? existing : { used: 0, resetAt: now + WINDOW_MS };

  if (bucket.used + images > IMAGES_PER_WINDOW) {
    buckets.set(key, bucket);
    return {
      ok: false,
      remaining: Math.max(0, IMAGES_PER_WINDOW - bucket.used),
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.used += images;
  buckets.set(key, bucket);
  return {
    ok: true,
    remaining: IMAGES_PER_WINDOW - bucket.used,
    retryAfterSeconds: 0,
  };
}

/**
 * Best-effort caller identity. Only proxy-set headers are trusted — never a
 * client-supplied body field, which would make the quota opt-out.
 */
export function callerKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
