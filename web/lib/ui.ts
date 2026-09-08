/**
 * The two top-bar actions, Filter and Watchlist, share one look.
 *
 * Indigo against a near-black page is the only saturated colour in the UI, and
 * it is taken from the logo's accent rather than invented. Everything else on
 * the screen is greyscale so the card art carries the colour — which is exactly
 * why these two read as buttons at a glance without needing a border or an icon.
 *
 * Defined here rather than in the top bar because RarityFilter renders its own
 * trigger, and importing it from a component that imports RarityFilter would be
 * a cycle.
 */
export const PILL =
  "rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-semibold tracking-wide text-white " +
  "transition-colors hover:bg-indigo-500 sm:px-4 sm:py-1.5 sm:text-sm";

/**
 * The neutral button used throughout the watchlist — sort, select, bulk actions.
 *
 * Deliberately not PILL. Indigo is the page's one saturated colour and it marks
 * the two controls that open something; spending it on a row of six toolbar
 * buttons would flatten that distinction and leave nothing for the card art to
 * stand out against.
 */
export const BUTTON =
  "rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 " +
  "transition-colors hover:border-neutral-500 hover:text-neutral-100 " +
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-700 sm:text-sm";

/**
 * Same shape, red on hover. Only for removal, which is the one action here that
 * cannot be undone by clicking again — the taste vector is rebuilt on the way
 * out, so a removed card is genuinely back in the deck's pool.
 */
export const DANGER_BUTTON =
  "rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 " +
  "transition-colors hover:border-red-800 hover:bg-red-950/40 hover:text-red-300 " +
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-700 " +
  "disabled:hover:bg-neutral-900 disabled:hover:text-neutral-300 sm:text-sm";

/** Joins class names without the trailing space an empty one would leave. */
export function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
