import Link from "next/link";

import { CardPrice } from "@/components/CardPrice";
import { feedImage } from "@/lib/images";
import type { Card } from "@/lib/types";

export function CardGrid({ cards }: { cards: Card[] }) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <li key={card.id} className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={feedImage(card.image_key)}
            alt={card.name}
            loading="lazy"
            className="w-full rounded-xl shadow-lg shadow-black/40"
          />
          {/* Between the art and the name, so the eye reads image → price →
              what it is. Absent entirely when unpriced, which is why the name
              below it is not positioned relative to it. */}
          <CardPrice card={card} />
          <p className="truncate text-xs text-neutral-300">{card.name}</p>
          {card.illustrator && (
            <Link
              href={`/artist/${encodeURIComponent(card.illustrator)}`}
              className="block truncate text-xs text-neutral-500 underline-offset-4 hover:underline"
            >
              {card.illustrator}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
