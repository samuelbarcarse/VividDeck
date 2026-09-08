"use client";

import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { feedImage } from "@/lib/images";
import type { Card, RarityGroup, SwipeDirection } from "@/lib/types";
import { join } from "@/lib/ui";
import { useCardQueue } from "@/lib/useCardQueue";

import { CardPrice } from "./CardPrice";
import { TopBar, type Account } from "./TopBar";

const DRAG_DISTANCE_THRESHOLD = 120;
const DRAG_VELOCITY_THRESHOLD = 500;

export function SwipeDeck({ rarityGroups, account }: { rarityGroups: RarityGroup[]; account: Account }) {
  const [rarities, setRarities] = useState<string[]>([]);

  return (
    // One viewport-height column: the bar takes what it needs and the deck gets
    // the rest. The page never scrolls, so a swipe can never be misread as a
    // scroll gesture.
    <main className="flex h-dvh w-full flex-col overflow-hidden">
      {/* Outside the keyed Deck below, so changing the filter does not remount
          the panel out from under the click that changed it. */}
      <TopBar rarityGroups={rarityGroups} rarities={rarities} onRaritiesChange={setRarities} account={account} />
      {/* The key is the reset. A filter change mounts a new Deck with a fresh
          queue and one new fetch, instead of tearing down state by hand and
          having to remember to extend that teardown every time state is added. */}
      <Deck key={rarities.length > 0 ? [...rarities].sort().join(",") : "all"} rarities={rarities} />
    </main>
  );
}

function Deck({ rarities }: { rarities: string[] }) {
  const { queue, ready, exhausted, error, advance } = useCardQueue(rarities);
  const current = queue[0];

  const swipe = useCallback(
    (card: Card, direction: SwipeDirection) => {
      // Advance immediately and POST in the background. Blocking the animation
      // on a network round trip is what makes a swipe feel broken.
      advance();
      void fetch("/api/swipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: card.id, direction }),
      });
    },
    [advance],
  );

  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") swipe(current, 1);
      if (event.key === "ArrowLeft") swipe(current, -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, swipe]);

  const onDragEnd = (card: Card) => (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (Math.abs(offset.x) > DRAG_DISTANCE_THRESHOLD || Math.abs(velocity.x) > DRAG_VELOCITY_THRESHOLD) {
      swipe(card, offset.x > 0 ? 1 : -1);
    }
  };

  // The filter itself lives in the top bar and stays mounted through all of
  // these states, so someone who filters their way into an empty feed can
  // always widen it again rather than being stranded.
  if (error || !ready || !current) {
    return (
      <Message>
        {error
          ? error
          : !ready
            ? "Loading…"
            : exhausted
              ? rarities.length > 0
                ? "No unswiped cards left in those rarities. Widen the filter to keep going."
                : "You have seen everything. Come back after the next set drops."
              : "Loading…"}
      </Message>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-3 pb-5 sm:px-5 sm:pb-6">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center gap-2 sm:gap-8">
        <SwipeHint direction={-1} onSwipe={() => swipe(current, -1)} />
        <div className="relative flex h-full min-w-0 max-w-md flex-1 items-center justify-center">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={current.id}
              className="absolute cursor-grab active:cursor-grabbing"
              drag="x"
              dragSnapToOrigin
              dragElastic={0.6}
              onDragEnd={onDragEnd(current)}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.18 } }}
              whileDrag={{ scale: 1.02 }}
            >
              {/* Never next/image: card art is served straight from R2. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={feedImage(current.image_key)}
                alt={current.name}
                draggable={false}
                className="max-h-[62dvh] w-auto select-none rounded-2xl shadow-2xl shadow-black/60"
              />
            </motion.div>
          </AnimatePresence>
        </div>
        <SwipeHint direction={1} onSwipe={() => swipe(current, 1)} />
      </div>
      <CardMeta card={current} />
    </div>
  );
}

/**
 * A drifting arrow either side of the card.
 *
 * A card that can be dragged does not look like one, and until you have tried it
 * once there is nothing on screen that says which way means what. The arrows
 * breathe rather than sit still because a static arrow reads as decoration; the
 * motion is what says "this direction is available to you".
 *
 * They are real buttons as well as hints, which costs nothing and gives the
 * mouse the same two moves the keyboard already had.
 */
function SwipeHint({ direction, onSwipe }: { direction: SwipeDirection; onSwipe: () => void }) {
  const reduced = useReducedMotion();
  const keep = direction === 1;

  return (
    <motion.button
      type="button"
      onClick={onSwipe}
      aria-label={keep ? "Keep this card" : "Skip this card"}
      className="flex shrink-0 flex-col items-center gap-1 text-neutral-400 transition-colors hover:text-neutral-100"
      // Steady and dim under prefers-reduced-motion: the affordance still has to
      // be legible, it just stops moving.
      animate={reduced ? { opacity: 0.55 } : { opacity: [0.15, 0.85, 0.15], x: keep ? [0, 8, 0] : [0, -8, 0] }}
      transition={reduced ? { duration: 0.2 } : { duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      // Hovering pins it open, so a pointer heading for the arrow is never
      // chasing something mid-fade.
      whileHover={{ opacity: 1 }}
    >
      <svg
        viewBox="0 0 40 24"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={join("h-6 w-9 sm:h-8 sm:w-14", !keep && "rotate-180")}
      >
        <path d="M3 12h33" />
        <path d="M26 3l10 9-10 9" />
      </svg>
      <span className="text-[10px] font-semibold uppercase tracking-widest sm:text-xs">{keep ? "Keep" : "Skip"}</span>
    </motion.button>
  );
}

/**
 * Price, name, set · rarity, artist.
 *
 * Two sizes, not four. The price and the name are the two things worth reading
 * from across a desk, so they share a size and are separated by weight instead;
 * everything below them is provenance and sits a full step down.
 */
function CardMeta({ card }: { card: Card }) {
  return (
    <div className="w-full max-w-md shrink-0 space-y-1 text-center">
      {/* Above the name, directly under the art. It used to sit last, below the
          illustrator, where it read as a footnote. */}
      <CardPrice card={card} tone="hero" />
      <p className="text-2xl font-semibold leading-tight text-neutral-100">{card.name}</p>
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
            className="underline-offset-4 hover:text-neutral-200 hover:underline"
          >
            {card.illustrator}
          </Link>
        </p>
      )}
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-neutral-500">{children}</div>;
}
