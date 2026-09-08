/**
 * The logarithmic scale behind the price slider.
 *
 * WHY NOT LINEAR
 *
 * Card prices in this catalog span five orders of magnitude and are piled up at
 * the bottom: 19,508 cards, median $0.72, p90 $27.86, max $4,500. On a linear
 * 0–5,000 track the median sits at 0.014% of the width and 55% of the catalog is
 * crushed into the first two hundredths of a percent. Every meaningful choice a
 * user could make would happen inside one pixel, and the remaining 99.98% of the
 * track would sort a few dozen cards. A linear slider is not a worse version of
 * this control; it is a control that cannot be operated.
 *
 * THE MAPPING
 *
 *   price(t) = OFFSET * (10^(DECADES * t) - 1),  t in [0, 1]
 *
 * The `- 1` is what lets the track start at exactly $0 — a pure log scale has no
 * zero to start from, and OFFSET sets how fast it leaves. With OFFSET = 0.05 and
 * DECADES = 5 the landmarks come out at:
 *
 *   t=0.0  $0        t=0.2  $0.45     t=0.4  $4.95
 *   t=0.6  $49.95    t=0.8  $499.95   t=1.0  $5,000
 *
 * which puts the median around 24% of the track, p75 at 40% and p90 at 55%. The
 * bottom half of the slider governs the half of the catalog people actually own,
 * and the top half still reaches the Charizards.
 *
 * ROUNDING
 *
 * Raw values off the curve are unreadable ($3.6714…). Rounding to a fixed number
 * of decimals instead creates dead zones: near $0 many consecutive steps would
 * round to the same cent and the handle would appear stuck. So the quantum grows
 * with the magnitude — cents at the bottom, $50 at the top — which keeps every
 * step a visible change while keeping every label round.
 */

/** Steps on the track. 200 is fine enough that no step is a visible jump. */
export const PRICE_STEPS = 200;

const DECADES = 5;
const OFFSET = 0.05;

/** The top of the track, as a number. Nothing in the catalog is near it. */
export const PRICE_CEILING = priceAtStep(PRICE_STEPS);

/** Round to a quantum that grows with magnitude, so no step is a dead zone. */
function quantize(price: number): number {
  const step = price < 1 ? 0.01 : price < 10 ? 0.05 : price < 100 ? 0.5 : price < 1000 ? 5 : 50;
  return Math.round(price / step) * step;
}

/** Slider step -> dollars. */
export function priceAtStep(step: number): number {
  const t = Math.min(Math.max(step, 0), PRICE_STEPS) / PRICE_STEPS;
  return quantize(OFFSET * (10 ** (DECADES * t) - 1));
}

/** Dollars -> nearest slider step. The inverse of the curve above. */
export function stepAtPrice(price: number): number {
  const t = Math.log10(Math.max(price, 0) / OFFSET + 1) / DECADES;
  return Math.min(Math.max(Math.round(t * PRICE_STEPS), 0), PRICE_STEPS);
}

/**
 * The dollar bound to send for a handle, or null for "no bound".
 *
 * A handle parked at either end means the user has not constrained that side, so
 * it must send null rather than 0 or 5000. This is the same rule the migration
 * states from the database side: null at the top of the track means "and above",
 * forever, so growing past the $5,000 ceiling can never make a card unreachable.
 */
export function boundAtStep(step: number, edge: "min" | "max"): number | null {
  if (edge === "min" && step <= 0) return null;
  if (edge === "max" && step >= PRICE_STEPS) return null;
  return priceAtStep(step);
}

/** "$0.72", "$27.85", "$5,000" — cents only where cents still mean something. */
export function formatPrice(price: number): string {
  const decimals = price < 100 ? 2 : 0;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** The human summary of a range, e.g. "$5.00 – $50.00", "Under $10.00", "Any". */
export function describeRange(minStep: number, maxStep: number): string {
  const min = boundAtStep(minStep, "min");
  const max = boundAtStep(maxStep, "max");
  if (min === null && max === null) return "Any";
  if (min === null) return `Under ${formatPrice(max as number)}`;
  if (max === null) return `${formatPrice(min)} and up`;
  return `${formatPrice(min)} – ${formatPrice(max)}`;
}
