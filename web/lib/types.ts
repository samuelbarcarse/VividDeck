export type SwipeDirection = 1 | -1;

export interface Card {
  id: string;
  name: string;
  image_key: string;
  illustrator: string | null;
  rarity: string | null;
  set_name: string | null;
  price_usd: number | null;
}

export interface FeedResponse {
  cards: Card[];
  /** Which bucket each card came from — useful while tuning the mix. */
  source: "random" | "mixed";
}
