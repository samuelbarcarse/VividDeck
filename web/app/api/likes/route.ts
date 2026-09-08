import { NextResponse } from "next/server";

import { LIKES_PAGE_SIZE, toLikesPage } from "@/lib/likes";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Pages through the caller's liked cards, newest first.
 *
 * Page one is rendered on the server by /liked; this serves every page after
 * it. Scoping is not done here — `list_likes` is security invoker and filters
 * on auth.uid(), so the session cookie decides what comes back and a forged
 * cursor can only move someone around inside their own list.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  // Both halves of the cursor or neither. Accepting one alone would silently
  // fall back to "start from the top" and re-serve page one forever, which
  // looks like an infinite list of duplicates rather than an error.
  const before = url.searchParams.get("before");
  const beforeId = url.searchParams.get("before_id");
  if ((before === null) !== (beforeId === null)) {
    return NextResponse.json({ error: "before and before_id must be sent together" }, { status: 400 });
  }

  // Postgres would reject an unparseable timestamp with a 500 that reads like a
  // server fault, so it is rejected here as the client error it is.
  if (before !== null && Number.isNaN(Date.parse(before))) {
    return NextResponse.json({ error: "before must be an ISO timestamp" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("list_likes", {
    p_limit: LIKES_PAGE_SIZE,
    p_before: before ?? undefined,
    p_before_id: beforeId ?? undefined,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Liked lists are per-user and change as you swipe, so they must never be
  // held by a shared cache.
  return NextResponse.json(toLikesPage(data ?? [], LIKES_PAGE_SIZE), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
