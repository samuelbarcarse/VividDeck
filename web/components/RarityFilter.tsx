"use client";

import { useCallback, useRef, useState } from "react";

import type { RarityGroup } from "@/lib/types";
import { PILL, join } from "@/lib/ui";
import { useDismiss } from "@/lib/useDismiss";

/**
 * Rarity checkboxes, behind the top bar's Filter button.
 *
 * Nothing ticked means no filter rather than no cards. That is the only sane
 * reading of an empty selection, and it also means unticking the last box
 * returns you to the full feed instead of an empty deck.
 *
 * The component owns its trigger as well as its panel, because the two have to
 * stay anchored to each other. It positions itself relative to whatever slot the
 * top bar puts it in rather than to the viewport.
 */
export function RarityFilter({
  groups,
  selected,
  onChange,
}: {
  groups: RarityGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useDismiss(
    open,
    container,
    useCallback(() => setOpen(false), []),
  );

  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  const active = selected.length;

  return (
    <div ref={container} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={join(PILL)}>
        Filter{active > 0 ? ` · ${active}` : ""}
      </button>

      {open && (
        // Anchored under the trigger and out of flow, so opening the panel does
        // not change the height of the bar and shove the deck down the page.
        <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-neutral-800 bg-neutral-950/95 p-3 text-left shadow-2xl shadow-black/60 backdrop-blur">
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
            <span>{active === 0 ? "Showing all" : `Showing ${active} of ${groups.length}`}</span>
            {active > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="underline-offset-4 hover:text-neutral-300 hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          <ul className="max-h-[50dvh] space-y-0.5 overflow-y-auto">
            {groups.map((group) => (
              <li key={group.key}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900">
                  <input
                    type="checkbox"
                    checked={selected.includes(group.key)}
                    onChange={() => toggle(group.key)}
                    className="h-4 w-4 shrink-0 accent-neutral-200"
                  />
                  <span>{group.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
