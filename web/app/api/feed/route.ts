import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import type { Card, FeedResponse } from "@/lib/types";

const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("n") ?? DEFAULT_BATCH);
  const n = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_BATCH) : DEFAULT_BATCH;

  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // The mix, the cold-start threshold and the taste math all live inside this
  // function so the weights have exactly one home. See db/migrations/0005.
  const { data, error } = await supabase.rpc("feed_for_user", { p_limit: n });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const body: FeedResponse = { cards: (data ?? []) as Card[] };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
