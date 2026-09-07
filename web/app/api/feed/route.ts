import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import type { Card, FeedResponse } from "@/lib/types";

const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requested = Number(params.get("n") ?? DEFAULT_BATCH);
  const n = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_BATCH) : DEFAULT_BATCH;

  // Absent and empty both mean "no filter". Null is passed rather than an empty
  // array so the intent is unambiguous at the SQL boundary.
  const rarities = (params.get("rarities") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // The mix, the cold-start threshold and the taste math all live inside this
  // function so the weights have exactly one home. See db/migrations/0005.
  // The rarity filter is applied there too, so no bucket can leak an unticked
  // group — see db/migrations/0009.
  const { data, error } = await supabase.rpc("feed_for_user", {
    p_limit: n,
    p_rarities: rarities.length > 0 ? rarities : undefined,
  });
  if (error) {
    // An unknown group key is a client bug, not a server fault: the function
    // raises rather than returning an empty batch that would look like "you
    // have seen everything".
    const status = error.message.includes("unknown rarity group") ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  const body: FeedResponse = { cards: (data ?? []) as Card[] };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
