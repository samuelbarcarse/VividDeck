"use client";

import { useCallback, useRef, useState } from "react";

import { NO_FILTER, activeCount, hasPriceFilter, type FeedFilter } from "@/lib/filters";
import { describeRange } from "@/lib/priceScale";
import type { RarityGroup } from "@/lib/types";
import { PILL, join } from "@/lib/ui";
import { useDismiss } from "@/lib/useDismiss";

import { PriceRange } from "./PriceRange";

/**
 * Rarity and Price, behind the top bar's Filter button.
 *
 * Two collapsed sections rather than two open ones. Rarity alone is a dozen
 * checkboxes; stacked under a slider it becomes a panel you have to scroll to
 * see the shape of, and the shape is the thing that tells you what filtering is
 * even on offer. Collapsed, the whole vocabulary fits in two lines, each showing
 * its current state, and you open only what you came for.
 *
 * Nothing selected means no filter rather than no cards, in both sections. That
 * is the only sane reading of an empty selection, and it means backing out of a
 * filter returns you to the full feed instead of an empty deck.
 *
 * The component owns its trigger as well as its panel, because the two have to
 * stay anchored to each other. It positions itself relative to whatever slot the
 * top bar puts it in rather than to the viewport.
 */
export function FilterPanel({
  groups,
  filter,
  onChange,
}: {
  groups: RarityGroup[];
  filter: FeedFilter;
  onChange: (next: FeedFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  // One section at a time, so the panel's height stays roughly constant and
  // opening the second one does not push the first off the bottom of the screen.
  const [section, setSection] = useState<"rarity" | "price" | null>(null);
  const container = useRef<HTMLDivElement>(null);
  useDismiss(
    open,
    container,
    useCallback(() => setOpen(false), []),
  );

  const toggleRarity = (key: string) => {
    const rarities = filter.rarities.includes(key)
      ? filter.rarities.filter((k) => k !== key)
      : [...filter.rarities, key];
    onChange({ ...filter, rarities });
  };

  const active = activeCount(filter);

  return (
    <div ref={container} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={join(PILL)}>
        Filter{active > 0 ? ` · ${active}` : ""}
      </button>

      {open && (
        // Anchored under the trigger and out of flow, so opening the panel does
        // not change the height of the bar and shove the deck down the page.
        <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-neutral-800 bg-neutral-950/95 p-2 text-left shadow-2xl shadow-black/60 backdrop-blur">
          <div className="flex items-center justify-between px-2 pb-1 pt-1 text-xs text-neutral-500">
            <span>Filter</span>
            {active > 0 && (
              <button
                type="button"
                onClick={() => onChange(NO_FILTER)}
                className="underline-offset-4 hover:text-neutral-300 hover:underline"
              >
                Reset all
              </button>
            )}
          </div>

          <Section
            title="Rarity"
            summary={filter.rarities.length === 0 ? "Any" : `${filter.rarities.length} of ${groups.length}`}
            active={filter.rarities.length > 0}
            open={section === "rarity"}
            onToggle={() => setSection((s) => (s === "rarity" ? null : "rarity"))}
          >
            <ul className="max-h-[38dvh] space-y-0.5 overflow-y-auto">
              {groups.map((group) => (
                <li key={group.key}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900">
                    <input
                      type="checkbox"
                      checked={filter.rarities.includes(group.key)}
                      onChange={() => toggleRarity(group.key)}
                      className="h-4 w-4 shrink-0 accent-indigo-500"
                    />
                    <span>{group.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Price"
            summary={describeRange(filter.minStep, filter.maxStep)}
            active={hasPriceFilter(filter)}
            open={section === "price"}
            onToggle={() => setSection((s) => (s === "price" ? null : "price"))}
          >
            {/* px-2 pt-1: the thumbs are round and overhang the track at both
                ends, so the slider needs breathing room the checkboxes do not. */}
            <div className="px-2 pb-1 pt-1">
              <PriceRange
                minStep={filter.minStep}
                maxStep={filter.maxStep}
                onChange={(minStep, maxStep) => onChange({ ...filter, minStep, maxStep })}
              />
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

/**
 * One collapsible row: title on the left, current state on the right.
 *
 * The summary is the point of the collapsed state. A row that just said "Price"
 * would force you to open it to find out whether it is doing anything, which is
 * the cost the accordion was supposed to save.
 */
function Section({
  title,
  summary,
  active,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-neutral-800/80 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2.5 text-left hover:bg-neutral-900"
      >
        <span className="text-sm font-semibold text-neutral-200">{title}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={join(
              "truncate text-xs tabular-nums",
              active ? "font-medium text-indigo-300" : "text-neutral-500",
            )}
          >
            {summary}
          </span>
          <svg
            viewBox="0 0 12 12"
            aria-hidden
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={join("h-3 w-3 shrink-0 text-neutral-500 transition-transform", open && "rotate-180")}
          >
            <path d="M3 4.5L6 7.5L9 4.5" />
          </svg>
        </span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}
