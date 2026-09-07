"use client";

import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect } from "react";

import { feedImage } from "@/lib/images";
import type { Card, SwipeDirection } from "@/lib/types";
import { useCardQueue } from "@/lib/useCardQueue";

const DRAG_DISTANCE_THRESHOLD = 120;
const DRAG_VELOCITY_THRESHOLD = 500;

export function SwipeDeck() {
  const { queue, ready, exhausted, error, advance } = useCardQueue();
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

  if (error) {
    return <Message>{error}</Message>;
  }
  if (!ready) {
    return <Message>Loading…</Message>;
  }
  if (!current) {
    return <Message>{exhausted ? "You have seen everything. Come back after the next set drops." : "Loading…"}</Message>;
  }

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-6 px-4 py-6">
      <div className="relative flex w-full max-w-md flex-1 items-center justify-center">
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
              className="max-h-[70dvh] w-auto select-none rounded-2xl shadow-2xl shadow-black/60"
            />
          </motion.div>
        </AnimatePresence>
      </div>
      <CardMeta card={current} />
    </div>
  );
}

function CardMeta({ card }: { card: Card }) {
  return (
    <div className="w-full max-w-md text-center text-sm text-neutral-400">
      <p className="text-base text-neutral-100">{card.name}</p>
      <p>
        {card.set_name}
        {card.rarity ? ` · ${card.rarity}` : ""}
      </p>
      {card.illustrator && (
        <p>
          <Link href={`/artist/${encodeURIComponent(card.illustrator)}`} className="underline-offset-4 hover:underline">
            {card.illustrator}
          </Link>
        </p>
      )}
      {card.price_usd !== null && <p className="text-xs text-neutral-600">${card.price_usd}</p>}
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="flex h-dvh items-center justify-center px-6 text-center text-neutral-500">{children}</div>;
}
