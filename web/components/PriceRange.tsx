"use client";

import { useState } from "react";

import { PRICE_STEPS, boundAtStep, describeRange, formatPrice, priceAtStep } from "@/lib/priceScale";

/**
 * Two handles on one logarithmic track.
 *
 * Two stacked native range inputs rather than a custom pointer implementation:
 * arrow keys, Home/End, page-up, focus rings and touch targets all come for
 * free and stay correct on platforms nobody here will test on. The thumb styling
 * that makes the stacking work lives in app/globals.css.
 *
 * Dragging is not committed on every step. A drag from end to end crosses 200 of
 * them, and each committed change remounts the deck and refetches — so the draft
 * lives here and is published on release.
 */
export function PriceRange({
  minStep,
  maxStep,
  onChange,
}: {
  minStep: number;
  maxStep: number;
  onChange: (minStep: number, maxStep: number) => void;
}) {
  const [draft, setDraft] = useState({ min: minStep, max: maxStep });

  // Follow the parent when it changes the range from outside — "Reset all", most
  // importantly, which has to move the handles and not just the numbers.
  //
  // Adjusted during render rather than in an effect. An effect would paint the
  // stale handles first and correct them on a second pass, and React's lint rule
  // rejects it outright; this pattern re-renders before the browser sees
  // anything. `seen` is what makes it terminate: it only fires on the render
  // where the props differ from the ones this draft was built from, so a commit
  // (which sets the props to the draft's own values) settles immediately.
  const [seen, setSeen] = useState({ min: minStep, max: maxStep });
  if (seen.min !== minStep || seen.max !== maxStep) {
    setSeen({ min: minStep, max: maxStep });
    setDraft({ min: minStep, max: maxStep });
  }

  const commit = () => {
    if (draft.min !== minStep || draft.max !== maxStep) onChange(draft.min, draft.max);
  };

  // Clamped rather than swapped: a handle dragged past its partner stops there.
  // Swapping means the thumb under the cursor is suddenly the other one, and the
  // drag continues moving something the user did not grab.
  const setMin = (value: number) => setDraft((d) => ({ ...d, min: Math.min(value, d.max) }));
  const setMax = (value: number) => setDraft((d) => ({ ...d, max: Math.max(value, d.min) }));

  const pct = (step: number) => (step / PRICE_STEPS) * 100;

  // Only decides which thumb wins when the two sit on the same spot. Up there
  // the max handle has nowhere to go, so the min handle is the one worth
  // grabbing; down at the bottom it is the other way round.
  const minOnTop = draft.min > PRICE_STEPS / 2;

  const shared = "range-thumb absolute inset-x-0 top-0 h-5 w-full bg-transparent";

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold tabular-nums text-neutral-200">{describeRange(draft.min, draft.max)}</p>

      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-neutral-800" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-indigo-500"
          style={{ left: `${pct(draft.min)}%`, right: `${100 - pct(draft.max)}%` }}
        />
        <input
          type="range"
          min={0}
          max={PRICE_STEPS}
          value={draft.min}
          onChange={(event) => setMin(Number(event.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className={shared}
          style={{ zIndex: minOnTop ? 4 : 3 }}
          aria-label="Minimum price"
          aria-valuetext={boundAtStep(draft.min, "min") === null ? "No minimum" : formatPrice(priceAtStep(draft.min))}
        />
        <input
          type="range"
          min={0}
          max={PRICE_STEPS}
          value={draft.max}
          onChange={(event) => setMax(Number(event.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className={shared}
          style={{ zIndex: minOnTop ? 3 : 4 }}
          aria-label="Maximum price"
          aria-valuetext={boundAtStep(draft.max, "max") === null ? "No maximum" : formatPrice(priceAtStep(draft.max))}
        />
      </div>

      {/* The track is logarithmic, so the ends alone would misread as linear.
          The midpoint label is what shows it is not: half the width buys $50. */}
      <div className="flex justify-between text-[10px] tabular-nums text-neutral-600">
        <span>$0</span>
        <span>$50</span>
        <span>$5,000+</span>
      </div>

      {/* 1,329 of 19,508 cards have no market price. They are in the feed until a
          bound is set and gone afterwards, which is a big silent change to make
          without saying so. */}
      <p className="text-[11px] leading-snug text-neutral-600">
        {draft.min > 0 || draft.max < PRICE_STEPS
          ? "Cards with no market price are hidden while a range is set."
          : "Drag either end. The scale is logarithmic, so most of the catalog sits in the lower half."}
      </p>
    </div>
  );
}
