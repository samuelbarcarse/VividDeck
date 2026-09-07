export type SwipeDirection = 1 | -1;

export interface Card {
  id: string;
  name: string;
  image_key: string;
  illustrator: string | null;
  rarity: string | null;
  set_name: string | null;
  price_usd: number | null;
  /** Which bucket served this card — useful while tuning the mix. */
  bucket?: "similar" | "random" | "recent";
}

export interface FeedResponse {
  cards: Card[];
}

/**
 * One filterable rarity tier.
 *
 * `key` is the canonical group, not the raw TCGdex string: those are 26 values
 * with duplicates across eras (`Holo Rare` and `Rare Holo` are the same card).
 * The mapping lives in the database — see db/migrations/0008 — so this type
 * never enumerates the groups and cannot drift from them.
 */
export interface RarityGroup {
  key: string;
  label: string;
}
