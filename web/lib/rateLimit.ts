import "server-only";

/**
 * Per-instance, in-memory, fixed-window rate limiting.
 *
 * What this is for. Every API route here ends in Postgres on a 500 MB free
 * tier, and `/api/feed` runs a 512-dimension vector search across ~19.5k
 * embeddings per call. A session costs one request to obtain, so without a limit
 * a single laptop can drive the database as hard as its uplink allows. This
 * bounds that.
 *
 * Be clear about what it does not do. The counters live in the memory of one
 * serverless instance. Vercel runs several under load and recycles them freely,
 * so the effective ceiling is the limit multiplied by however many instances
 * happen to be warm, and it resets whenever one is reclaimed. A distributed
 * attacker defeats it outright by spreading across addresses.
 *
 * That is a deliberate trade rather than an oversight. The alternative — Redis,
 * or a counters table in Postgres — buys exactness at the cost of either a paid
 * dependency or a database write on the very path being protected, which hands
 * an attacker a cheaper way to do the damage the limiter exists to prevent. A
 * loose limit with no moving parts stops the realistic case (one script, one
 * address, no effort) and costs nothing. The real defence against mass account
 * creation is CAPTCHA on anonymous sign-in, which is a Supabase dashboard
 * setting; nothing in this file substitutes for it.
 *
 * Fixed window, not sliding: a caller can burst up to 2x the limit across a
 * window boundary. Accepted for the same reason as above — the numbers below are
 * set an order of magnitude above human behaviour, so a 2x edge case is noise.
 */

interface Window {
  count: number;
  resetAt: number;
}

export interface Budget {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface Decision {
  allowed: boolean;
  /** Whole seconds until the window resets. Sent as Retry-After on a refusal. */
  retryAfter: number;
}

/**
 * Ceiling on tracked keys, so the limiter cannot become the memory exhaustion
 * it was added to prevent. An attacker rotating addresses inserts a new key per
 * request; without this the map is an unbounded write target.
 */
const MAX_TRACKED_KEYS = 10_000;

const windows = new Map<string, Window>();

/**
 * Budgets are generous on purpose. A fast human swipes perhaps twice a second
 * and pulls twenty cards per feed call, so these sit far above real use and are
 * shaped to stop scripts rather than to ration people. Several users behind one
 * office or campus NAT share an address, which is the other reason not to run
 * these close to human speed.
 */
export const BUDGETS = {
  /** Vector search — the expensive one. 60/min is a feed call every second. */
  feed: { limit: 60, windowMs: 60_000 },
  /** One row per call. 240/min is four swipes a second, sustained. */
  swipe: { limit: 240, windowMs: 60_000 },
  /** Bulk edits from the watchlist; rare by nature. */
  likes: { limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, Budget>;

/**
 * Drop expired entries, and if the map is still over budget drop the oldest
 * live ones too.
 *
 * Map iterates in insertion order, so the oldest keys come first. Evicting a
 * live counter fails open for that key — it gets a fresh budget — which is the
 * right direction to fail: refusing service to real users to punish a key-
 * rotating attacker would hand them the outage they were trying to cause.
 */
function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  if (windows.size <= MAX_TRACKED_KEYS) return;

  const excess = windows.size - MAX_TRACKED_KEYS;
  let dropped = 0;
  for (const key of windows.keys()) {
    if (dropped >= excess) break;
    windows.delete(key);
    dropped += 1;
  }
}

/**
 * Count one request against `key` and say whether it may proceed.
 *
 * Not exported for direct use by routes — they call `enforce`, which pairs this
 * with the client key and returns a ready-made 429.
 */
function consume(key: string, { limit, windowMs }: Budget): Decision {
  const now = Date.now();

  // Amortised: only walks the map when it has grown past the ceiling, so the
  // common path stays a single lookup.
  if (windows.size > MAX_TRACKED_KEYS) sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/**
 * Best-effort client address.
 *
 * `x-vercel-forwarded-for` is set by Vercel's edge and cannot be spoofed by the
 * client, so it is preferred. `x-forwarded-for` is a client-supplied header
 * anywhere else and is only trusted as a fallback — worth having for local
 * development, not worth relying on. Its leftmost entry is the original client.
 *
 * A missing address collapses every anonymous caller onto one shared bucket.
 * That is intentional: the failure mode of "unattributable traffic shares a
 * budget" is the safe one.
 */
function clientKey(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.trim();

  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return "unknown";
}

/**
 * Route guard. Returns a 429 Response to return immediately, or null to proceed.
 *
 * Call this before `auth.getUser()`. That call is a network round trip to
 * Supabase and counts against its own quota, so refusing first is both cheaper
 * and the point — a rate limiter that runs after the expensive work has already
 * started is decoration.
 */
export function enforce(request: Request, name: keyof typeof BUDGETS): Response | null {
  const budget = BUDGETS[name];
  const { allowed, retryAfter } = consume(`${name}:${clientKey(request)}`, budget);
  if (allowed) return null;

  return Response.json(
    { error: "too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "private, no-store",
      },
    },
  );
}
