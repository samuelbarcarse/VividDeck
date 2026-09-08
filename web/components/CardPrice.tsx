import { formatUsd, tcgplayerUrl } from "@/lib/price";
import type { Card } from "@/lib/types";
import { join } from "@/lib/ui";

/** "No price" is a real answer, not a blank. */
const NO_PRICE = "No Price Listed";

/**
 * The two places a price appears want the same logic at very different scales,
 * so the size lives here rather than being passed in as a class.
 *
 * A caller that passed `text-2xl` alongside this component's own `text-xs` would
 * not reliably win: Tailwind decides between two utilities of the same group by
 * their order in the generated stylesheet, not by their order in the attribute.
 * An explicit tone is the difference between a size that is chosen and one that
 * happens to work.
 *
 * Within a tone the priced and unpriced states are deliberately the same size.
 * On the deck the price sits directly under the art and the next card is one
 * swipe away — if "No Price Listed" set a different line height, the name, set
 * and artist below it would jump every time an unpriced card came up. Weight and
 * colour carry the distinction instead.
 */
const TONES = {
  /** Under a thumbnail in a grid of many. */
  grid: {
    price: "text-xs tabular-nums text-neutral-400",
    link: "text-neutral-400 hover:text-neutral-200",
    missing: "text-xs text-neutral-600",
  },
  /** Under the single card on the deck, matched in size to the card's name. */
  hero: {
    price: "text-2xl font-bold leading-tight tabular-nums text-neutral-100",
    link: "text-neutral-100 hover:text-white",
    missing: "text-2xl font-normal leading-tight text-neutral-600",
  },
} as const;

export type PriceTone = keyof typeof TONES;

/**
 * The price line that sits between a card's art and its name.
 *
 * Always renders something. Roughly 1 card in 15 has no TCGplayer price at all
 * (1,329 of 19,508 at the last sync) and leaving those blank made the grid look
 * like it had failed to finish loading, rather than saying the thing that is
 * actually true: nobody is listing this card. The placeholder is set dimmer than
 * a real price so a wall of them does not compete with the cards that do have
 * one.
 *
 * When we know the TCGplayer product the price becomes a link, because the
 * number is a market average across conditions and the reader who cares about
 * the difference between a Near Mint and a Moderately Played copy can only get
 * that from the source. See lib/price.ts.
 */
export function CardPrice({
  card,
  tone = "grid",
  className = "",
}: {
  card: Card;
  tone?: PriceTone;
  className?: string;
}) {
  const styles = TONES[tone];
  const label = formatUsd(card.price_usd);
  const href = tcgplayerUrl(card.tcgplayer_product_id);

  if (label === null) {
    return (
      <p className={join(styles.missing, className)} title="TCGplayer has no market price for this card">
        {NO_PRICE}
      </p>
    );
  }

  const title = `TCGplayer market price${href ? " — click for listings by condition" : ""}`;

  if (href === null) {
    return (
      <p className={join(styles.price, className)} title={title}>
        {label}
      </p>
    );
  }

  return (
    <p className={join(styles.price, className)}>
      <a
        href={href}
        target="_blank"
        // noreferrer as well as noopener: this is an outbound commercial link and
        // there is no reason to hand TCGplayer the URL of the page it came from.
        rel="noopener noreferrer"
        title={title}
        className={join(styles.link, "underline-offset-4 hover:underline")}
      >
        {label}
      </a>
    </p>
  );
}
