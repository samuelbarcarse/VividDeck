"use client";

import { useEffect, type RefObject } from "react";

/**
 * Closes a popover on click-away or Escape.
 *
 * Shared by the two panels that hang off the top bar. Both sit over the deck,
 * which is draggable: a panel that only closed via its own trigger would eat
 * the first swipe after it opened, and that reads as the app being stuck rather
 * than as a menu being open.
 *
 * `mousedown` rather than `click`, so the panel is gone before the press that
 * dismissed it can land on whatever was underneath.
 */
export function useDismiss(open: boolean, container: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, container, close]);
}
