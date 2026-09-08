import { formatUsd, tcgplayerUrl } from "@/lib/price";
import type { Card } from "@/lib/types";

/**
 * The price line that sits between a card's art and its name.
 *
 * Renders nothing at all when the card has no price. That is deliberate: a
 * placeholder dash in a grid of 60 tiles reads as "still loading" and a "$0.00"
 * reads as free, when the truth is simply that TCGplayer has no listing for it.
 *
 * When we know the TCGplayer product it becomes a link, because the number is a
 * market average across conditions and the reader who cares about the
 * difference between a Near Mint and a Moderately Played copy can only get that
 * from the source. See lib/price.ts.
 */
export function CardPrice({ card, className = "" }: { card: Card; className?: string }) {
  const label = formatUsd(card.price_usd);
  if (label === null) return null;

  const href = tcgplayerUrl(card.tcgplayer_product_id);
  const title = `TCGplayer market price${href ? " — click for listings by condition" : ""}`;

  if (href === null) {
    return (
      <p className={`text-xs tabular-nums text-neutral-400 ${className}`} title={title}>
        {label}
      </p>
    );
  }

  return (
    <p className={`text-xs tabular-nums ${className}`}>
      <a
        href={href}
        target="_blank"
        // noreferrer as well as noopener: this is an outbound commercial link and
        // there is no reason to hand TCGplayer the URL of the page it came from.
        rel="noopener noreferrer"
        title={title}
        className="text-neutral-400 underline-offset-4 hover:text-neutral-200 hover:underline"
      >
        {label}
      </a>
    </p>
  );
}
