"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CardGrid } from "@/components/CardGrid";
import type { LikesCursor } from "@/lib/likes";
import type { Card } from "@/lib/types";

/**
 * The liked list, extended as you scroll.
 *
 * Page one arrives already rendered from the server component, so the grid is
 * complete on first paint and this only takes over once you reach the bottom.
 */
export function LikedGrid({
  initialCards,
  initialCursor,
}: {
  initialCards: Card[];
  initialCursor: LikesCursor | null;
}) {
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [cursor, setCursor] = useState<LikesCursor | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against the observer firing again while a request is in flight.
  // State cannot do this job: `loading` is only visible to the next render, so
  // two intersections in the same frame would both see `false` and both fetch.
  const inFlight = useRef(false);
  const sentinel = useRef<HTMLButtonElement | null>(null);

  const loadMore = useCallback(async () => {
    if (inFlight.current || !cursor) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ before: cursor.before, before_id: cursor.before_id });
      const response = await fetch(`/api/likes?${params}`);
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }

      const page = (await response.json()) as { cards: Card[]; nextCursor: LikesCursor | null };

      setCards((current) => {
        // The keyset cursor already guarantees no overlap between pages. This
        // is here so that if that ever stops being true the page degrades to a
        // missing card rather than to duplicate React keys.
        const seen = new Set(current.map((card) => card.id));
        return [...current, ...page.cards.filter((card) => !seen.has(card.id))];
      });
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more likes.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [cursor]);

  useEffect(() => {
    const node = sentinel.current;
    // No sentinel means the list is complete.
    //
    // Stopping on error is what keeps this from becoming a hot retry loop. The
    // sentinel sits at the bottom of a list the reader has already scrolled to,
    // so it is still on screen when the request fails; re-observing it fires the
    // callback immediately and the failure repeats as fast as the network
    // allows. After an error the button stays, but only a real click retries.
    if (!node || error) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      // Start fetching before the sentinel is actually on screen, so the next
      // rows are usually there by the time the reader arrives.
      { rootMargin: "600px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, error]);

  return (
    <div className="space-y-6">
      <CardGrid cards={cards} />

      {error && (
        <p className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {cursor && (
        // A real button, not a bare div: the observer drives it in the common
        // case, but this keeps the rest of the list reachable by keyboard and
        // if IntersectionObserver never fires.
        <button
          ref={sentinel}
          type="button"
          onClick={() => void loadMore()}
          disabled={loading}
          className="w-full rounded-xl border border-neutral-800 px-4 py-3 text-sm text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-50"
        >
          {loading ? "Loading…" : error ? "Try again" : "Load more"}
        </button>
      )}

      {!cursor && cards.length > 0 && (
        <p className="text-center text-xs text-neutral-600">
          That&rsquo;s all {cards.length} of them.
        </p>
      )}
    </div>
  );
}
