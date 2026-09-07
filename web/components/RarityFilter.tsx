"use client";

import { useEffect, useRef, useState } from "react";

import type { RarityGroup } from "@/lib/types";

/**
 * Rarity checkboxes.
 *
 * Nothing ticked means no filter rather than no cards. That is the only sane
 * reading of an empty selection, and it also means unticking the last box
 * returns you to the full feed instead of an empty deck.
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

  // Click-away and Escape, so the panel never traps the deck underneath it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  const active = selected.length;

  return (
    <div ref={container} className="absolute left-4 top-4 z-20">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="rounded-full border border-neutral-800 bg-neutral-950/80 px-3 py-1 text-sm text-neutral-400 backdrop-blur transition-colors hover:border-neutral-700 hover:text-neutral-200"
      >
        Rarity{active > 0 ? ` · ${active}` : ""}
      </button>

      {open && (
        <div className="mt-2 w-64 rounded-xl border border-neutral-800 bg-neutral-950/95 p-3 shadow-2xl shadow-black/60 backdrop-blur">
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
