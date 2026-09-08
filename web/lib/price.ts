/**
 * Formatting and linking for the one price number a card shows.
 *
 * WHAT THE NUMBER IS
 *
 * `card.price_usd` is the TCGplayer *market price* of a card's cheapest
 * variant — weighted from completed sales, so it is the closest honest answer
 * to "what does this actually trade for". It is not a condition-specific
 * price. TCGdex, which is where our prices come from, exposes only per-variant
 * listing statistics (low / mid / high / market); Near Mint, Lightly Played and
 * the rest live behind TCGplayer's credentialed partner API and are not
 * available to us. See db/migrations/0012 for the full reasoning.
 *
 * That is why the price links out rather than expanding into a grade table: a
 * user who needs condition-specific pricing should land on the real listings
 * instead of a number we invented.
 */

/**
 * A fixed locale, not the visitor's.
 *
 * This renders on the server and again on the client. If the formatter followed
 * the browser locale the two would disagree for anyone outside en-US ("$1,234.50"
 * vs "$1.234,50") and React would report a hydration mismatch. The currency is
 * USD regardless of who is looking, because that is the currency TCGplayer
 * quotes in — so formatting it in a European style would be a different kind of
 * wrong anyway.
 */
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Renders a price for display, or null when there is nothing honest to show.
 *
 * Null means no TCGplayer listing was found, which is a real and common state:
 * promos, very new sets, and anything outside the English catalog often have no
 * pricing at all. Callers should render nothing rather than "$0.00" or "—",
 * since a zero would read as a real price and a dash invites the reader to
 * think the number is loading.
 */
export function formatUsd(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return USD.format(value);
}

/**
 * The TCGplayer product page for a card.
 *
 * The id identifies a product page, not a single variant listing — a card's
 * normal and reverse-holofoil printings commonly share one — so this lands the
 * reader on the page that lists every printing and every condition.
 */
export function tcgplayerUrl(productId: number | null | undefined): string | null {
  if (productId === null || productId === undefined || !Number.isFinite(productId)) return null;
  return `https://www.tcgplayer.com/product/${productId}`;
}
