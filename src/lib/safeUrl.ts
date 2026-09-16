import { lookup } from "node:dns/promises";

/**
 * Guards the "paste any URL you like" feature, which is otherwise a
 * server-side request forgery hole: without this, anyone could point a webhook
 * at http://169.254.169.254/ and have our server fetch cloud credentials for
 * them, or sweep a private network from inside it.
 *
 * Hostname checks alone are not enough — a name under an attacker's control can
 * resolve straight to 127.0.0.1 — so the resolved addresses are what get
 * checked, and every address must pass.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split("%")[0];
  if (lower === "::" || lower === "::1") return true; // unspecified, loopback
  if (lower.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(lower)) return true; // unique local
  // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 hat, still needs the v4 rules.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

export async function checkOutboundUrl(raw: string): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That doesn't look like a valid URL." };
  }

  // http:// would send the URL — and anything in it — in clear text, and is
  // almost always a sign of an internal address.
  if (url.protocol !== "https:") {
    return { ok: false, reason: "Webhook URLs must start with https://" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Credentials in the URL aren't supported." };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { ok: false, reason: "That address is on a private network." };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: "That hostname couldn't be resolved." };
  }
  if (addresses.length === 0) return { ok: false, reason: "That hostname couldn't be resolved." };

  // Every address, not just the first: a name that resolves to one public and
  // one private address must not be treated as safe.
  for (const { address, family } of addresses) {
    const blocked = family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
    if (blocked) return { ok: false, reason: "That address is on a private network." };
  }

  return { ok: true };
}

/** Exported for tests — the address rules are the part worth exercising directly. */
export const __test = { isBlockedIPv4, isBlockedIPv6 };
