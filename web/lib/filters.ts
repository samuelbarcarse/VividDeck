import { PRICE_STEPS, boundAtStep } from "./priceScale";

/**
 * Everything the feed can be narrowed by, in one value.
 *
 * The price range is carried as slider *steps*, not dollars. The steps are what
 * the control owns and what a reopened panel has to restore exactly; dollars are
 * derived at the request boundary. Keeping both would give the same fact two
 * homes and a way to disagree.
 */
export interface FeedFilter {
  rarities: string[];
  minStep: number;
  maxStep: number;
}

export const NO_FILTER: FeedFilter = { rarities: [], minStep: 0, maxStep: PRICE_STEPS };

/**
 * What the deck opens on for a new visitor.
 *
 * Not the same thing as NO_FILTER, and deliberately so. The catalog is 55%
 * Common and Uncommon, which are the rarities printed without bespoke art — a
 * cold deck drawn from everything spends most of its first impression on cards
 * whose illustration is a stock pose. Illustration Rares are the tier that
 * exists *because* of the art, so opening there shows the product at its best
 * before the taste vector has anything to work with.
 *
 * Both illustration tiers, since Special Illustration Rare is a grade of the
 * same thing rather than a different kind of card. Together they are 715
 * swipeable cards against 493 for the base tier alone — still a small pool, so
 * a determined user will reach the end of it. That is what the Filter control is
 * for, and the pill reads "1" from first load precisely so the narrowing is
 * visible rather than mysterious.
 *
 * The keys are the primary keys of public.rarity_groups (db/migrations/0008).
 * feed_for_user raises on an unknown group and the route turns that into a 400,
 * so a key that stopped existing would fail loudly on first load rather than
 * quietly serving an unfiltered deck.
 */
export const DEFAULT_FILTER: FeedFilter = {
  rarities: ["illustration_rare", "special_illustration_rare"],
  minStep: 0,
  maxStep: PRICE_STEPS,
};

/** Has the user actually constrained price, or are both handles parked? */
export function hasPriceFilter(filter: FeedFilter): boolean {
  return filter.minStep > 0 || filter.maxStep < PRICE_STEPS;
}

/** How many sections are narrowed — the number on the Filter pill. */
export function activeCount(filter: FeedFilter): number {
  return (filter.rarities.length > 0 ? 1 : 0) + (hasPriceFilter(filter) ? 1 : 0);
}

/**
 * The query string for a filter.
 *
 * Also the remount key for the card queue, which is why it is built from sorted
 * rarities and omits absent bounds: two filters that mean the same thing must
 * produce the same string, or an unticked-and-reticked box would throw away a
 * queue for nothing.
 */
export function filterQuery(filter: FeedFilter): URLSearchParams {
  const query = new URLSearchParams();
  if (filter.rarities.length > 0) query.set("rarities", [...filter.rarities].sort().join(","));

  const min = boundAtStep(filter.minStep, "min");
  const max = boundAtStep(filter.maxStep, "max");
  if (min !== null) query.set("min_price", String(min));
  if (max !== null) query.set("max_price", String(max));

  return query;
}
