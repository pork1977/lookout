/**
 * Analytics, such as it is. One table in the Supabase project that already
 * exists, written to with a plain POST, read with one SQL query.
 *
 * Deliberately not a third-party analytics service. The question this has to
 * answer is small: how many strangers in a week got from the homepage to a
 * detector they trained and watched fire, and which post sent them. A table
 * and a view do that without another account, another bundle, or visitor data
 * going to anyone else.
 *
 * Nothing a visitor typed or photographed goes out. No descriptions, no group
 * names, no camera labels, no image data. Counts arrive as bands, everything
 * else is a fixed string from the lists below.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The live site, and only the live site. No env var to set and nothing extra
 * to remember: a preview deployment, a local dev server and anyone else's
 * clone all stay out of the numbers, because the funnel is meant to describe
 * strangers rather than whoever is working on it that evening.
 */
const LIVE_HOSTS = ["lookout.vision", "www.lookout.vision"];

export type LookoutEvent =
  /** Any page opened, including client-side navigation. The top of the funnel. */
  | "page_viewed"
  /** The no-training demo on the homepage got a camera running. */
  | "live_demo_started"
  /** One step of the build wizard came into view. The spine of the funnel. */
  | "build_step_reached"
  /** AI-assisted labelling was actually run, the one call that costs money. */
  | "ai_labelling_used"
  | "training_started"
  | "detector_trained"
  | "training_failed"
  | "watch_started"
  /** A trained detector fired for real. The end that matters. */
  | "detector_fired"
  | "share_link_created"
  | "detector_exported"
  | "account_created";

type Props = Record<string, string | number | boolean>;

/**
 * One id per page load, held in memory and never written to the visitor's
 * device. No cookie, no local storage, so nothing to put a consent banner in
 * front of. The cost is that a visit tomorrow looks like a new person, which
 * is the right trade for counting strangers rather than following them.
 *
 * Both routes into the builder are next/link, so a visit that starts on the
 * homepage and goes on to train something stays one session.
 */
let sessionId: string | null = null;

/** Where they came from, read once from the landing URL and sent with each row. */
let source: string | null = null;

function enabled(): boolean {
  if (!url || !anonKey) return false;
  if (typeof window === "undefined") return false;
  return LIVE_HOSTS.includes(window.location.hostname);
}

function session(): string {
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    // utm_source only, and capped. Whatever else is hung off the URL is none
    // of this table's business.
    const tag = new URLSearchParams(window.location.search).get("utm_source");
    source = tag ? tag.slice(0, 60) : null;
  }
  return sessionId;
}

/**
 * A run link's slug is a capability: holding it is permission to run that
 * detector. It has no business in here, so the path is collapsed back to its
 * route before being recorded.
 */
function routeOf(pathname: string): string {
  if (pathname.startsWith("/run/")) return "/run/[slug]";
  return pathname.slice(0, 200);
}

function send(name: LookoutEvent, props: Props, pathname?: string) {
  // Analytics failing is never a reason for anything else to fail, and the
  // first of these runs before React has hydrated.
  try {
    const body = JSON.stringify({
      session_id: session(),
      name,
      props,
      source,
      // The path, never the query string: a URL can carry anything.
      path: routeOf(pathname ?? window.location.pathname),
    });

    // keepalive so an event fired on the way out of the page still goes.
    // Prefer: return=minimal because the anon role can insert and nothing
    // else, so asking for the row back would be refused.
    void fetch(`${url}/rest/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey as string,
        Authorization: `Bearer ${anonKey}`,
        Prefer: "return=minimal",
      },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Deliberately silent.
  }
}

export function track(name: LookoutEvent, props: Props = {}) {
  if (!enabled()) return;
  send(name, props);
}

/**
 * Separate from `track` because Next's router hook fires at the START of a
 * navigation, when the address bar still shows the page being left. The
 * destination has to be passed in or every move would be recorded backwards.
 */
export function trackPageView(pathname?: string) {
  if (!enabled()) return;
  send("page_viewed", {}, pathname);
}

/**
 * Fired at most once per page load for a given event and property set. Walking
 * back and forth through the wizard would otherwise read as several different
 * people arriving at Examples.
 */
const already = new Set<string>();

export function trackOnce(name: LookoutEvent, props: Props = {}) {
  if (!enabled()) return;
  const key = `${name}:${Object.keys(props)
    .sort()
    .map((k) => `${k}=${props[k]}`)
    .join(",")}`;
  if (already.has(key)) return;
  already.add(key);
  send(name, props);
}

/**
 * Counts go in as a band, not a number. "How many people trained on fewer than
 * ten photos" is worth answering; the exact 7 is not, and a precise count with
 * a timestamp beside it starts to describe a person.
 */
export function countBand(n: number): string {
  if (n <= 0) return "0";
  if (n < 5) return "1-4";
  if (n < 10) return "5-9";
  if (n < 20) return "10-19";
  if (n < 50) return "20-49";
  return "50+";
}

/** Training-set accuracy, banded. Always optimistic, useful only as a shape. */
export function accuracyBand(accuracy: number): string {
  const pct = Math.round(accuracy * 100);
  if (pct >= 100) return "100";
  if (pct >= 95) return "95-99";
  if (pct >= 90) return "90-94";
  if (pct >= 80) return "80-89";
  if (pct >= 70) return "70-79";
  return "under-70";
}
