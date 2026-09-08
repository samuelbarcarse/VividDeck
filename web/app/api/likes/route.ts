import { NextResponse } from "next/server";

import { enforce } from "@/lib/rateLimit";
import { createServerSupabase } from "@/lib/supabase/server";
import { WATCHLIST_LIMIT } from "@/lib/watchlist";

/**
 * The two things you can do to a card that is already on your watchlist:
 * move it between in progress and completed, or take it off.
 *
 * There is no GET. The list arrives whole from the server component that renders
 * /liked — see lib/watchlist.ts for why it is not paginated — so a second way to
 * read it would only be a second thing to keep in sync.
 *
 * Scoping is not done here. Both RPCs are security invoker and filter on
 * auth.uid(), so the session cookie decides which rows are reachable and a
 * forged card id can only name a card in the caller's own list. The auth check
 * below exists to turn "not signed in" into a 401 instead of a Postgres
 * exception surfacing as a 500.
 *
 * The route stays /api/likes to match the /liked page and the `direction = 1`
 * rows in `swipes` that both actually operate on.
 */

/** Parsed request body, or the message explaining why it was rejected. */
type Parsed = { cardIds: string[] } | { error: string };

/**
 * Ids are validated rather than passed through, because `p_card_ids` is typed
 * `text[]` and a nested array or a number would fail inside Postgres — a 500
 * describing a type mismatch, for what is plainly a bad request.
 */
function parseCardIds(body: unknown): Parsed {
  if (typeof body !== "object" || body === null || !("card_ids" in body)) {
    return { error: "card_ids is required" };
  }
  const raw: unknown = body.card_ids;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || id === "")) {
    return { error: "card_ids must be an array of non-empty strings" };
  }
  if (raw.length === 0) {
    return { error: "card_ids must not be empty" };
  }
  // The whole list is a legitimate selection — "select all, remove" is one of
  // the things the bulk controls are for — so the cap is the list's own ceiling
  // rather than something smaller that would break that case.
  if (raw.length > WATCHLIST_LIMIT) {
    return { error: `card_ids must hold at most ${WATCHLIST_LIMIT} ids` };
  }
  // Duplicates are dropped rather than rejected. Both RPCs use `= any(...)`, so
  // a repeated id already matches the same row once, and refusing the request
  // would fail a selection the user cannot see anything wrong with.
  return { cardIds: [...new Set(raw as string[])] };
}

async function readBody(request: Request): Promise<unknown> {
  return await request.json().catch(() => null);
}

async function requireUser() {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  return { supabase, user: auth.user };
}

/**
 * Removes cards from the watchlist.
 *
 * `unlike_cards` also subtracts the removed cards' embeddings from the taste
 * running sums, which is what makes this a real undo rather than a hidden
 * corruption of the feed. See db/migrations/0015.
 */
export async function DELETE(request: Request) {
  // Both verbs are counted against one shared budget, since they cost the same
  // and a caller alternating between them is one caller.
  const refused = enforce(request, "likes");
  if (refused) return refused;

  const parsed = parseCardIds(await readBody(request));
  if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });

  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data, error } = await supabase.rpc("unlike_cards", { p_card_ids: parsed.cardIds });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The count is what the caller asked for, not what it assumed. A card already
  // removed in another tab comes back as 0 rather than as a success.
  return NextResponse.json({ removed: data ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Moves cards between in progress and completed. */
export async function PATCH(request: Request) {
  const refused = enforce(request, "likes");
  if (refused) return refused;

  const body = await readBody(request);
  const parsed = parseCardIds(body);
  if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });

  // Strictly boolean. Coercing would make `"false"` mean completed, and this is
  // the field that decides which section a card lands in.
  const completed =
    typeof body === "object" && body !== null && "completed" in body ? body.completed : undefined;
  if (typeof completed !== "boolean") {
    return NextResponse.json({ error: "completed must be true or false" }, { status: 400 });
  }

  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data, error } = await supabase.rpc("set_cards_completed", {
    p_card_ids: parsed.cardIds,
    p_completed: completed,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ changed: data ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
}
