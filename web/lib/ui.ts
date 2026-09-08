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

/** Joins class names without the trailing space an empty one would leave. */
export function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
