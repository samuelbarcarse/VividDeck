import type { Card } from "./types";

/**
 * The watchlist arrives whole and is sorted, filtered and sectioned in the
 * browser. Everything that decides what the list looks like lives here.
 *
 * WHY NOT IN SQL
 *
 * See the header of db/migrations/0015. The short version: none of these
 * operations can be done correctly on a page. "Cheapest first" over the most
 * recent 60 of 300 likes returns the cheapest of an arbitrary subset — a wrong
 * answer rather than a partial one. A watchlist is bounded by how many cards a
 * human right-swipes, so the whole set is a few hundred rows and sorting it is
 * free next to the round trip that would fetch the next page.
 */

/**
 * Hard ceiling on the list, matching the `least(..., 2000)` clamp inside
 * `list_watchlist`. Duplicated deliberately: the database enforces it, and this
 * is what lets the page say so out loud instead of silently showing a truncated
 * sort. If the two ever disagree, the database wins and the notice is wrong —
 * change both, and read the migration header before raising either.
 */
export const WATCHLIST_LIMIT = 2000;

/**
 * How many likes an anonymous visitor needs before being asked to sign in.
 * SPEC: "Offer optional email upgrade from the liked view once a user has ~20
 * likes worth keeping." Prompting on the first like is the version that gets
 * dismissed, because at one like there is nothing to lose yet.
 */
export const SAVE_PROMPT_MIN_LIKES = 20;

/** A liked card plus the two things the watchlist adds: when, and how far along. */
export interface WatchlistCard extends Card {
  liked_at: string;
  /** Null means in progress. Non-null is when it was marked completed. */
  completed_at: string | null;
}

/** Shape returned by the `list_watchlist` RPC, before it is narrowed. */
export interface WatchlistRow {
  card_id: string;
  liked_at: string;
  completed_at: string | null;
  name: string;
  image_key: string;
  illustrator: string | null;
  rarity: string | null;
  price_usd: number | null;
  set_name: string | null;
  tcgplayer_product_id: number | null;
}

/**
 * Turns RPC rows into cards.
 *
 * Supabase's type generator reports every column of a `returns table` as
 * non-null, so the nullable ones are re-widened here rather than trusted.
 */
export function toWatchlist(rows: WatchlistRow[]): WatchlistCard[] {
  return rows.map((row) => ({
    id: row.card_id,
    liked_at: row.liked_at,
    completed_at: row.completed_at ?? null,
    name: row.name,
    image_key: row.image_key,
    illustrator: row.illustrator ?? null,
    rarity: row.rarity ?? null,
    price_usd: row.price_usd ?? null,
    set_name: row.set_name ?? null,
    tcgplayer_product_id: row.tcgplayer_product_id ?? null,
  }));
}

export type SortKey = "recent" | "oldest" | "price-high" | "price-low" | "name" | "artist";

/** The order the sort menu lists them in; the first is the default. */
export const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently added" },
  { key: "oldest", label: "Oldest first" },
  { key: "price-high", label: "Price: high to low" },
  { key: "price-low", label: "Price: low to high" },
  { key: "name", label: "Name A–Z" },
  { key: "artist", label: "Artist A–Z" },
];

/**
 * A fixed locale, not the visitor's, for the same reason lib/price.ts fixes one:
 * the order must not depend on who is looking. `base` sensitivity makes "Ōmura"
 * and "Omura" sort together, which is what someone scanning a list of Japanese
 * illustrator names actually wants.
 */
const COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });

type Comparator = (a: WatchlistCard, b: WatchlistCard) => number;

/**
 * Compares on a field that may be missing, putting missing last in every order.
 *
 * An unpriced card is not a cheap card — TCGplayer simply has no market price
 * for it — so floating those to the top of "price: low to high" would answer a
 * question nobody asked. Same for a card with no illustrator credit under
 * "Artist A–Z". Last is the only position that does not assert something false,
 * which is why the null handling sits here and not in each comparator: it must
 * not accidentally follow the sort direction.
 */
function present<T>(pick: (card: WatchlistCard) => T | null, compare: (a: T, b: T) => number): Comparator {
  return (a, b) => {
    const x = pick(a);
    const y = pick(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return compare(x, y);
  };
}

/** Newest first, then by id — total, so the sort below is deterministic. */
const byRecency: Comparator = (a, b) => b.liked_at.localeCompare(a.liked_at) || b.id.localeCompare(a.id);

const price = (card: WatchlistCard) => card.price_usd;

const COMPARATORS: Record<SortKey, Comparator> = {
  recent: byRecency,
  oldest: (a, b) => -byRecency(a, b),
  "price-high": present(price, (x, y) => y - x),
  "price-low": present(price, (x, y) => x - y),
  name: (a, b) => COLLATOR.compare(a.name, b.name),
  artist: present((card) => card.illustrator, COLLATOR.compare.bind(COLLATOR)),
};

/**
 * Sorts a copy, never in place.
 *
 * Every order falls back to recency and then to id, so ties never shuffle
 * between renders — a grid whose equal-priced cards swap places each time you
 * tick a checkbox looks broken even though the sort is technically honoured.
 */
export function sortCards(cards: WatchlistCard[], key: SortKey): WatchlistCard[] {
  const compare = COMPARATORS[key];
  return [...cards].sort((a, b) => compare(a, b) || byRecency(a, b));
}

/**
 * Every term has to match somewhere, but not all in the same field.
 *
 * "charizard mitsuhiro" should find the Charizard drawn by Mitsuhiro Arita, so
 * the terms are tested against the whole haystack rather than field by field.
 * AND rather than OR because a second word is how you narrow a result you can
 * already see too much of.
 */
export function matchesQuery(card: WatchlistCard, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [card.name, card.illustrator, card.set_name, card.rarity]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** In progress and completed, in the caller's chosen order. */
export function splitSections(cards: WatchlistCard[]): {
  inProgress: WatchlistCard[];
  completed: WatchlistCard[];
} {
  return {
    inProgress: cards.filter((card) => card.completed_at === null),
    completed: cards.filter((card) => card.completed_at !== null),
  };
}
