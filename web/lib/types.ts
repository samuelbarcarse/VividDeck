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
