"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { detailImage } from "@/lib/images";
import { tcgplayerUrl } from "@/lib/price";
import { BUTTON, DANGER_BUTTON, join } from "@/lib/ui";
import { useDismiss } from "@/lib/useDismiss";
import type { WatchlistCard } from "@/lib/watchlist";

import { CardPrice } from "./CardPrice";

/**
 * One card, filling the screen, over a blurred page.
 *
 * The blur is not decoration. The grid behind it is a wall of card art, and a
 * plain dim would leave every one of those still legible and still competing
 * with the card you opened. Blurring turns them back into texture.
 *
 * The image is detail.webp, which is 600x825 — the largest TCGdex has. The panel
 * is capped near that so the art is never upscaled into softness, which on a
 * page whose entire subject is card art would be the one unforgivable bug.
 *
 * There is no price history here and no chart. `card_prices` is overwritten on
 * every sync and keeps exactly one row per (card, variant), so we have no
 * history to draw — see db/migrations/0012. The TCGplayer link is the honest
 * version of that feature.
 */
export function CardDetail({
  card,
  onClose,
  onToggleCompleted,
  onRemove,
  busy,
}: {
  card: WatchlistCard;
  onClose: () => void;
  onToggleCompleted: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useDismiss(true, panel, onClose);

  // Focus moves into the dialog on open and back to where it came from on close.
  // Without this, Escape drops focus onto <body> and the next Tab restarts at the
  // top of the page rather than at the card you were just looking at.
  useEffect(() => {
    const restoreTo = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (restoreTo instanceof HTMLElement) restoreTo.focus();
    };
  }, []);

  // The page behind must not scroll under the overlay: on a trackpad the grid
  // slides around beneath the blur, which reads as the modal having come loose.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const completed = card.completed_at !== null;
  const href = tcgplayerUrl(card.tcgplayer_product_id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-md sm:p-8">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={card.name}
        className="relative flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950/95 p-4 shadow-2xl shadow-black/70 sm:flex-row sm:gap-6 sm:p-6"
      >
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
        >
          <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>

        {/* Never next/image: card art is served straight from R2. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={detailImage(card.image_key)}
          alt={card.name}
          className="mx-auto max-h-[46dvh] w-auto shrink-0 rounded-xl shadow-2xl shadow-black/60 sm:max-h-[74dvh]"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="space-y-1 pr-8">
            <CardPrice card={card} tone="hero" />
            <h2 className="text-2xl font-semibold leading-tight text-neutral-100">{card.name}</h2>
            <p className="text-sm text-neutral-500">
              {card.set_name}
              {card.rarity && (
                <>
                  {" · "}
                  <span className="font-medium text-neutral-300">{card.rarity}</span>
                </>
              )}
            </p>
            {card.illustrator && (
              <p className="text-sm text-neutral-500">
                <Link
                  href={`/artist/${encodeURIComponent(card.illustrator)}`}
                  // /artist is a page navigation, and leaving the dialog mounted
                  // over it would strand the reader behind a blur.
                  onClick={onClose}
                  className="underline-offset-4 hover:text-neutral-200 hover:underline"
                >
                  {card.illustrator}
                </Link>
              </p>
            )}
          </div>

          <dl className="space-y-1 text-xs text-neutral-500">
            <Row label="Added">{formatDay(card.liked_at)}</Row>
            <Row label="Status">
              {completed ? (
                <span className="text-emerald-400">Completed {formatDay(card.completed_at)}</span>
              ) : (
                "In progress"
              )}
            </Row>
          </dl>

          {/* mt-auto pins the actions to the bottom on desktop, where the column
              is as tall as the art and floating buttons mid-panel look adrift. */}
          <div className="mt-auto flex flex-wrap gap-2">
            <button type="button" onClick={onToggleCompleted} disabled={busy} className={BUTTON}>
              {completed ? "Move to in progress" : "Mark completed"}
            </button>
            {href && (
              <a
                href={href}
                target="_blank"
                // noreferrer as well as noopener: this is an outbound commercial
                // link and there is no reason to hand TCGplayer the page it came
                // from.
                rel="noopener noreferrer"
                className={join(BUTTON, "inline-block")}
              >
                View on TCGplayer ↗
              </a>
            )}
            <button type="button" onClick={onRemove} disabled={busy} className={DANGER_BUTTON}>
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-neutral-600">{label}</dt>
      <dd className="min-w-0 text-neutral-400">{children}</dd>
    </div>
  );
}

/**
 * A fixed locale for the same reason lib/price.ts fixes one: this renders only
 * in the browser today, but a formatter that follows the visitor would still be
 * a hydration mismatch waiting for the day this moves to the server.
 */
const DAY = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });

function formatDay(iso: string | null): string {
  if (iso === null) return "—";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : DAY.format(at);
}
