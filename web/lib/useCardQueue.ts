"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { feedImage } from "./images";
import { ensureSession } from "./supabase/client";
import type { Card, FeedResponse } from "./types";

const QUEUE_TARGET = 20;
const REFILL_BELOW = 8;

/**
 * Warm the browser cache so the next card is already decoded when it surfaces.
 * A visible load between cards is the difference between an app someone uses
 * for twenty minutes and one they delete.
 */
function preload(card: Card): void {
  const image = new Image();
  image.src = feedImage(card.image_key);
}

export function useCardQueue() {
  const [queue, setQueue] = useState<Card[]>([]);
  const [ready, setReady] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef(false);
  // The feed excludes swiped cards server-side, but an optimistic swipe may not
  // have landed yet when the next batch is requested, so dedupe on the client too.
  const seen = useRef(new Set<string>());

  const refill = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch(`/api/feed?n=${QUEUE_TARGET}`);
      if (!response.ok) {
        throw new Error((await response.json().catch(() => ({}))).error ?? `feed failed (${response.status})`);
      }
      const body = (await response.json()) as FeedResponse;
      const fresh = body.cards.filter((card) => !seen.current.has(card.id));
      fresh.forEach((card) => {
        seen.current.add(card.id);
        preload(card);
      });
      setExhausted(fresh.length === 0);
      setQueue((current) => [...current, ...fresh]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not load cards");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSession();
        if (cancelled) return;
        await refill();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "could not start a session");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refill]);

  const advance = useCallback(() => {
    setQueue((current) => {
      const next = current.slice(1);
      if (next.length < REFILL_BELOW) void refill();
      return next;
    });
  }, [refill]);

  return { queue, ready, exhausted, error, advance, refill };
}
