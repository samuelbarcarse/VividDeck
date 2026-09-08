import type { Card } from "./types";

/**
 * Rows per page in the liked view.
 *
 * Shared by the server component that renders page one and the route handler
 * that serves the rest. If these two ever disagreed the client would compute
 * "did I get a full page?" against the wrong number and stop early, which is
 * the exact bug this view already had.
 */
export const LIKES_PAGE_SIZE = 60;

/**
 * How many likes an anonymous visitor needs before being asked to sign in.
 * SPEC: "Offer optional email upgrade from the liked view once a user has ~20
 * likes worth keeping." Prompting on the first like is the version that gets
 * dismissed, because at one like there is nothing to lose yet.
 */
export const SAVE_PROMPT_MIN_LIKES = 20;

/**
 * Position in the list, as (liked_at, card_id).
 *
 * Both halves are required. Ordering on the timestamp alone is not total, so a
 * tie spanning a page boundary would either drop the tied rows or repeat one
 * forever depending on which comparison you picked.
 */
export interface LikesCursor {
  before: string;
  before_id: string;
}

export interface LikesPage {
  cards: Card[];
  /** null once the server returned a short page, meaning there is no more. */
  nextCursor: LikesCursor | null;
}

/** Shape returned by the `list_likes` RPC, before it is narrowed to a `Card`. */
interface LikeRow {
  card_id: string;
  liked_at: string;
  name: string;
  image_key: string;
  illustrator: string | null;
  rarity: string | null;
  price_usd: number | null;
  set_name: string | null;
}

/**
 * Turns RPC rows into cards plus the cursor for the next page.
 *
 * Supabase's type generator reports every column of a `returns table` as
 * non-null, so the nullable ones are re-widened here rather than trusted.
 */
export function toLikesPage(rows: LikeRow[], pageSize: number): LikesPage {
  const cards: Card[] = rows.map((row) => ({
    id: row.card_id,
    name: row.name,
    image_key: row.image_key,
    illustrator: row.illustrator ?? null,
    rarity: row.rarity ?? null,
    price_usd: row.price_usd ?? null,
    set_name: row.set_name ?? null,
  }));

  // A short page means the list is exhausted. A full page might still be the
  // last one; the next request then comes back empty and settles it. That costs
  // one extra request and avoids ever claiming "no more" while rows remain.
  const last = rows.length === pageSize ? rows[rows.length - 1] : undefined;

  return {
    cards,
    nextCursor: last ? { before: last.liked_at, before_id: last.card_id } : null,
  };
}
