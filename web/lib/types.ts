export type SwipeDirection = 1 | -1;

export interface Card {
  id: string;
  name: string;
  image_key: string;
  illustrator: string | null;
  rarity: string | null;
  set_name: string | null;
  /**
   * TCGplayer market price of the cheapest variant, in USD. Null when there is
   * no listing — common for promos and very new sets. Not condition-specific;
   * see lib/price.ts.
   */
  price_usd: number | null;
  /** TCGplayer product page id, for linking the price out. Null when unpriced. */
  tcgplayer_product_id: number | null;
  /** Which bucket served this card — useful while tuning the mix. */
  bucket?: "similar" | "random" | "recent";
}

export interface FeedResponse {
  cards: Card[];
}

/**
 * Everything the top bar needs to know about who is looking.
 *
 * Resolved on the server in every page that renders the bar. It lives here
 * rather than beside the bar because both the deck and the watchlist build one,
 * and neither should have to import a component to describe a session.
 */
export interface Account {
  email: string | null;
  avatarUrl: string | null;
  anonymousSession: boolean;
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
