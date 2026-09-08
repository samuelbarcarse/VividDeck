"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { feedImage } from "@/lib/images";
import { BUTTON, DANGER_BUTTON, join } from "@/lib/ui";
import {
  SORTS,
  WATCHLIST_LIMIT,
  matchesQuery,
  sortCards,
  splitSections,
  type SortKey,
  type WatchlistCard,
} from "@/lib/watchlist";

import { CardDetail } from "./CardDetail";
import { CardPrice } from "./CardPrice";

/**
 * The watchlist: two sections, sorted and searched in the browser.
 *
 * WHY EVERYTHING IS LOCAL
 *
 * The whole list arrives with the page, so sorting, searching and sectioning are
 * pure functions of state and cost one pass over a few hundred rows. Nothing
 * here refetches. That is what makes "cheapest first" mean the cheapest of your
 * watchlist rather than the cheapest of the page you happen to be on — see
 * lib/watchlist.ts and db/migrations/0015.
 *
 * WHY MUTATIONS ARE OPTIMISTIC
 *
 * Marking a card completed is a one-click move between two sections a few
 * hundred pixels apart. Waiting on a round trip before the card moves makes the
 * click feel unregistered and invites a second one, which — before the RPC
 * started skipping no-op writes — would have rewritten the timestamp. The list
 * changes immediately and rolls back to exactly what it was if the request
 * fails, with the reason shown rather than swallowed.
 */
export function Watchlist({ initial }: { initial: WatchlistCard[] }) {
  const [cards, setCards] = useState<WatchlistCard[]>(initial);
  const [sort, setSort] = useState<SortKey>("recent");
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => sortCards(cards.filter((card) => matchesQuery(card, query)), sort),
    [cards, query, sort],
  );
  const { inProgress, completed } = useMemo(() => splitSections(visible), [visible]);

  // Looked up rather than held, so a card whose status changes under the open
  // modal re-renders it instead of showing a stale copy of itself.
  const openCard = openId === null ? null : (cards.find((card) => card.id === openId) ?? null);

  /**
   * Applies a change locally, sends it, and puts the list back if it fails.
   *
   * The snapshot taken here is the authoritative list precisely because every
   * control that can call this is disabled while `busy`. One request is in
   * flight at a time, so there is no second edit for a rollback to clobber.
   */
  const mutate = async (next: WatchlistCard[], send: () => Promise<Response>, verb: string) => {
    const before = cards;
    setCards(next);
    setBusy(true);
    setError(null);
    try {
      const response = await send();
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : `Request failed (${response.status})`;
        throw new Error(message);
      }
    } catch (err) {
      setCards(before);
      setError(`Could not ${verb}: ${err instanceof Error ? err.message : "network error"}`);
    } finally {
      setBusy(false);
    }
  };

  const setCompleted = (ids: string[], value: boolean) => {
    // The local timestamp is a placeholder for the one Postgres is writing. It
    // only decides what the detail panel prints, and a reload replaces it with
    // the real value; the section a card lands in depends on null vs non-null,
    // which is exact either way.
    const at = value ? new Date().toISOString() : null;
    const ids_ = new Set(ids);
    void mutate(
      cards.map((card) => (ids_.has(card.id) ? { ...card, completed_at: at } : card)),
      () =>
        fetch("/api/likes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card_ids: ids, completed: value }),
        }),
      value ? "mark completed" : "move back to in progress",
    );
  };

  const remove = (ids: string[]) => {
    const ids_ = new Set(ids);
    if (openId !== null && ids_.has(openId)) setOpenId(null);
    setSelected((current) => new Set([...current].filter((id) => !ids_.has(id))));
    void mutate(
      cards.filter((card) => !ids_.has(card.id)),
      () =>
        fetch("/api/likes", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card_ids: ids }),
        }),
      "remove those cards",
    );
  };

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Selection mode always starts and ends empty, so nothing acts on a stale set. */
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const chosen = [...selected];
  const anyCompleted = cards.some((card) => card.completed_at !== null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {/* type="search" for the clear affordance browsers already give it, and
            because on iOS it puts a Search key on the keyboard. */}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, artist, set…"
          aria-label="Search your watchlist"
          className="min-w-0 flex-1 rounded-full border border-neutral-800 bg-neutral-900 px-4 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
        />

        {/* A native select, not a custom menu: six options do not justify
            reimplementing keyboard handling, and this is correct on touch. */}
        <label className="sr-only" htmlFor="watchlist-sort">
          Sort
        </label>
        <select
          id="watchlist-sort"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          className={join(BUTTON, "cursor-pointer appearance-none pr-3")}
        >
          {SORTS.map((option) => (
            <option key={option.key} value={option.key} className="bg-neutral-900">
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          aria-pressed={selecting}
          className={join(BUTTON, selecting && "border-indigo-500 text-indigo-300")}
        >
          {selecting ? "Done" : "Select"}
        </button>
      </div>

      {selecting && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 py-2">
          <span className="text-sm tabular-nums text-neutral-400">
            {chosen.length} selected
          </span>
          <button
            type="button"
            onClick={() => setSelected(new Set(visible.map((card) => card.id)))}
            disabled={busy || visible.length === 0}
            className={BUTTON}
          >
            {/* "shown", not "all": with a search active these are different
                numbers, and selecting rows you cannot see is how you delete
                something you did not mean to. */}
            Select all shown ({visible.length})
          </button>
          <button type="button" onClick={() => setSelected(new Set())} disabled={busy || chosen.length === 0} className={BUTTON}>
            Clear
          </button>
          <span className="mx-1 h-4 w-px bg-neutral-800" aria-hidden />
          <button type="button" onClick={() => setCompleted(chosen, true)} disabled={busy || chosen.length === 0} className={BUTTON}>
            Mark completed
          </button>
          <button type="button" onClick={() => setCompleted(chosen, false)} disabled={busy || chosen.length === 0} className={BUTTON}>
            Move to in progress
          </button>
          <button type="button" onClick={() => remove(chosen)} disabled={busy || chosen.length === 0} className={DANGER_BUTTON}>
            Remove
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {cards.length >= WATCHLIST_LIMIT && (
        <p className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200/90">
          Showing the {WATCHLIST_LIMIT.toLocaleString("en-US")} most recent likes. Anything older is not on this page, so
          the sorting and totals below cover only these.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="py-10 text-center text-neutral-500">
          {query ? `Nothing in your watchlist matches “${query}”.` : "Nothing liked yet."}
        </p>
      ) : (
        <>
          <Section title="In progress" count={inProgress.length}>
            {inProgress.length === 0 ? (
              <Empty>Everything shown here is completed.</Empty>
            ) : (
              <Grid
                cards={inProgress}
                selecting={selecting}
                selected={selected}
                busy={busy}
                onOpen={setOpenId}
                onToggleSelected={toggleSelected}
                onToggleCompleted={(id) => setCompleted([id], true)}
              />
            )}
          </Section>

          {/* Rendered even when empty, so the feature is discoverable before the
              first card is ever moved. Suppressed once a search is narrowing the
              list, where an empty section says nothing useful. */}
          {(completed.length > 0 || (!query && !anyCompleted)) && (
            <Section title="Completed" count={completed.length}>
              {completed.length === 0 ? (
                <Empty>Use the ✓ on a card to move it here when you are done with it.</Empty>
              ) : (
                <Grid
                  cards={completed}
                  selecting={selecting}
                  selected={selected}
                  busy={busy}
                  onOpen={setOpenId}
                  onToggleSelected={toggleSelected}
                  onToggleCompleted={(id) => setCompleted([id], false)}
                />
              )}
            </Section>
          )}
        </>
      )}

      {openCard && (
        <CardDetail
          card={openCard}
          busy={busy}
          onClose={() => setOpenId(null)}
          onToggleCompleted={() => setCompleted([openCard.id], openCard.completed_at === null)}
          onRemove={() => remove([openCard.id])}
        />
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-baseline gap-2 border-b border-neutral-900 pb-2 text-sm font-semibold uppercase tracking-widest text-neutral-400">
        {title}
        <span className="text-xs font-normal tabular-nums text-neutral-600">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-neutral-600">{children}</p>;
}

function Grid({
  cards,
  selecting,
  selected,
  busy,
  onOpen,
  onToggleSelected,
  onToggleCompleted,
}: {
  cards: WatchlistCard[];
  selecting: boolean;
  selected: ReadonlySet<string>;
  busy: boolean;
  onOpen: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onToggleCompleted: (id: string) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <Tile
          key={card.id}
          card={card}
          selecting={selecting}
          selected={selected.has(card.id)}
          busy={busy}
          onOpen={() => onOpen(card.id)}
          onToggleSelected={() => onToggleSelected(card.id)}
          onToggleCompleted={() => onToggleCompleted(card.id)}
        />
      ))}
    </ul>
  );
}

/**
 * One card: art, price, name, artist — plus two controls layered over the art.
 *
 * The art is a button whose meaning changes with the mode: normally it opens the
 * card, and in selection mode it selects. One target rather than a checkbox you
 * have to hit precisely, which is the difference between usable and not on a
 * phone.
 *
 * The status toggle is a sibling of that button, never a child. Nesting one
 * button inside another is invalid HTML and browsers recover from it by
 * discarding the inner one, which would silently cost the whole one-click move.
 */
function Tile({
  card,
  selecting,
  selected,
  busy,
  onOpen,
  onToggleSelected,
  onToggleCompleted,
}: {
  card: WatchlistCard;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onOpen: () => void;
  onToggleSelected: () => void;
  onToggleCompleted: () => void;
}) {
  const completed = card.completed_at !== null;

  return (
    <li className="relative space-y-1">
      <button
        type="button"
        onClick={selecting ? onToggleSelected : onOpen}
        aria-label={selecting ? `Select ${card.name}` : `Open ${card.name}`}
        aria-pressed={selecting ? selected : undefined}
        className="block w-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {/* Never next/image: card art is served straight from R2. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={feedImage(card.image_key)}
          alt={card.name}
          loading="lazy"
          className={join(
            "w-full rounded-xl shadow-lg shadow-black/40 transition",
            selecting && !selected && "opacity-50 hover:opacity-80",
            selected && "ring-2 ring-indigo-500",
            // Completed cards read as done at a glance without a badge that
            // would cover the art. Only outside selection mode, where dimming
            // already means "not selected" and two meanings for one signal is
            // worse than none.
            !selecting && completed && "opacity-60 hover:opacity-100",
          )}
        />
      </button>

      {selecting ? (
        <span
          aria-hidden
          className={join(
            "pointer-events-none absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full border text-xs",
            selected ? "border-indigo-400 bg-indigo-600 text-white" : "border-neutral-500 bg-black/60 text-transparent",
          )}
        >
          ✓
        </span>
      ) : (
        <button
          type="button"
          onClick={onToggleCompleted}
          disabled={busy}
          title={completed ? "Move back to in progress" : "Mark completed"}
          aria-label={completed ? `Move ${card.name} back to in progress` : `Mark ${card.name} completed`}
          aria-pressed={completed}
          className={join(
            "absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border text-sm backdrop-blur transition-colors disabled:opacity-40",
            completed
              ? "border-emerald-400/70 bg-emerald-600/90 text-white hover:bg-emerald-500"
              : "border-neutral-500/80 bg-black/50 text-neutral-300 hover:border-emerald-400 hover:text-emerald-300",
          )}
        >
          ✓
        </button>
      )}

      {/* Between the art and the name, so the eye reads image → price → what it
          is. Absent entirely when unpriced, which is why the name below it is
          not positioned relative to it. */}
      <CardPrice card={card} />
      <p className="truncate text-xs text-neutral-300">{card.name}</p>
      {card.illustrator && (
        <Link
          href={`/artist/${encodeURIComponent(card.illustrator)}`}
          className="block truncate text-xs text-neutral-500 underline-offset-4 hover:underline"
        >
          {card.illustrator}
        </Link>
      )}
    </li>
  );
}
