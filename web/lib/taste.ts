import "server-only";

export const EMBEDDING_DIM = 512;

/** Below this many swipes there is not enough signal, so the feed stays random. */
export const COLD_START_SWIPES = 10;

/**
 * How much a dislike pulls the taste vector away, relative to a like.
 * Deliberately less than 1: disliking a card says "not this one", which is
 * weaker evidence than a like says "more of this".
 */
export const DISLIKE_WEIGHT = 0.3;

/**
 * Feed composition. The 20% random bucket is the product, not a tuning knob:
 * a pure similarity feed converges within ~40 swipes and then shows the same
 * popular cards forever, which is the exact failure this app exists to fix.
 * Do not shrink it for engagement reasons.
 */
export const FEED_MIX = {
  similar: 0.7,
  random: 0.2,
  recent: 0.1,
} as const;

/** Sets released within this window feed the "recent" bucket. */
export const RECENT_WINDOW_MONTHS = 12;

export interface TasteRow {
  liked_sum: number[] | null;
  liked_count: number;
  disliked_sum: number[] | null;
  disliked_count: number;
}

function scale(vector: number[], factor: number): number[] {
  return vector.map((value) => value * factor);
}

function subtract(a: number[], b: number[]): number[] {
  return a.map((value, index) => value - b[index]);
}

function normalize(vector: number[]): number[] | null {
  const magnitude = Math.hypot(...vector);
  // An all-zero vector has no direction to point in, so there is no taste yet.
  if (magnitude === 0 || !Number.isFinite(magnitude)) return null;
  return scale(vector, 1 / magnitude);
}

/**
 * taste = normalize( liked_mean - DISLIKE_WEIGHT * disliked_mean )
 *
 * Means, not sums, so that a user with 400 dislikes and 20 likes is not
 * dominated by the dislike term purely on volume. The running sums are
 * maintained incrementally on each swipe, which keeps this O(1) rather than
 * O(swipes) — never recompute it from the full swipe history.
 *
 * Card embeddings are unit-normalized at ingest, so cosine similarity against
 * this vector is a plain dot product.
 */
export function computeTaste(row: TasteRow): number[] | null {
  const liked = row.liked_sum && row.liked_count > 0 ? scale(row.liked_sum, 1 / row.liked_count) : null;
  const disliked =
    row.disliked_sum && row.disliked_count > 0 ? scale(row.disliked_sum, 1 / row.disliked_count) : null;

  if (!liked && !disliked) return null;
  if (!liked) return null; // dislikes alone describe where not to go, not where to go
  if (!disliked) return normalize(liked);

  return normalize(subtract(liked, scale(disliked, DISLIKE_WEIGHT)));
}

/** Split a batch size into per-bucket counts that always sum to n. */
export function bucketSizes(n: number): { similar: number; random: number; recent: number } {
  const random = Math.round(n * FEED_MIX.random);
  const recent = Math.round(n * FEED_MIX.recent);
  return { similar: n - random - recent, random, recent };
}

/** pgvector accepts its literal form as a string: '[0.1,0.2,...]'. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
