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

function consume(key: string, amount: number, limit: number, windowMs: number): QuotaDecision {
  const now = Date.now();
  prune(now);

  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now ? existing : { used: 0, resetAt: now + windowMs };

  if (bucket.used + amount > limit) {
    buckets.set(key, bucket);
    return {
      ok: false,
      remaining: Math.max(0, limit - bucket.used),
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.used += amount;
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.used, retryAfterSeconds: 0 };
}

export function consumeImageQuota(key: string, images: number): QuotaDecision {
  return consume(`img:${key}`, images, IMAGES_PER_WINDOW, WINDOW_MS);
}

/**
 * Dispatches are cheap for us but not for whoever is on the other end of the
 * webhook, so this is as much about not making the app a convenient way to
 * flood someone else's endpoint as about our own costs.
 */
export function consumeDispatchQuota(key: string): QuotaDecision {
  return consume(`disp:${key}`, 1, 60, 5 * 60 * 1000);
}

/**
 * Best-effort caller identity. Only proxy-set headers are trusted, never a
 * client-supplied body field, which would make the quota opt-out.
 */
export function callerKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
