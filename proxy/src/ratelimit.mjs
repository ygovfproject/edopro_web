// In-memory rate limiting. The proxy runs as a single process, so counters kept in
// memory are exact; they reset when the service restarts.

/**
 * A sliding-window limiter: at most `limit` hits per key within any `windowMs`.
 * Keeps the timestamps of recent hits per key (small: limits here are at most 120).
 */
export class RateLimiter {
  constructor(limit, windowMs, now = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map(); // key -> sorted timestamps
  }

  /** Records a hit. Returns { ok, retryAfter } (retryAfter in seconds when not ok). */
  hit(key) {
    const r = this.check(key);
    if (r.ok) this.hits.get(key).push(this.now());
    return r;
  }

  /** Like hit(), but doesn't record anything (for limits that only count failures). */
  check(key) {
    const t = this.now();
    const from = t - this.windowMs;
    let list = this.hits.get(key);
    if (list) {
      while (list.length && list[0] <= from) list.shift();
    } else {
      list = [];
      this.hits.set(key, list);
    }
    if (list.length >= this.limit) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0] + this.windowMs - t) / 1000)) };
    }
    return { ok: true, retryAfter: 0 };
  }

  /** Drops keys with no recent hits (called periodically to bound memory). */
  sweep() {
    const from = this.now() - this.windowMs;
    for (const [key, list] of this.hits) {
      if (!list.length || list[list.length - 1] <= from) this.hits.delete(key);
    }
  }
}

/** The limits of the accounts API (see README "Accounts and cloud decks"). */
export const LIMITS = {
  user: { limit: 120, windowMs: 60_000 }, // any request, per signed-in user
  ip: { limit: 60, windowMs: 60_000 }, // any request without a valid session, per IP
  list: { limit: 30, windowMs: 60_000 }, // deck listing, per user
  write: { limit: 10, windowMs: 60_000 }, // deck create / update / delete, per user
  login: { limit: 5, windowMs: 15 * 60_000 }, // login attempts, per IP
  loginUser: { limit: 10, windowMs: 15 * 60_000 }, // failed logins, per username (from any IP)
  password: { limit: 5, windowMs: 15 * 60_000 }, // password checks when deleting the account, per user
  register: { limit: 5, windowMs: 60 * 60_000 }, // new accounts, per IP
};

/**
 * The rate-limit key for a client address. IPv6 clients usually get a whole /64, so
 * every address in it counts as one client; IPv4 addresses count individually.
 */
export function ipKey(ip) {
  const a = String(ip).replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  if (!a.includes(":")) return a;
  const [head, tail = ""] = a.toLowerCase().replace(/%.*$/, "").split("::");
  const h = head ? head.split(":") : [];
  const tl = tail ? tail.split(":") : [];
  if (!a.includes("::") && h.length !== 8) return a; // not an IPv6 address we understand
  const groups = a.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - tl.length)).fill("0"), ...tl] : h;
  return groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(":") + "::/64";
}
