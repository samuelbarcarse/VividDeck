import { NextResponse } from "next/server";

import { enforce } from "@/lib/rateLimit";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Card, FeedResponse } from "@/lib/types";

const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;

export async function GET(request: Request) {
  // First statement in the handler: this route runs a vector search over every
  // embedded card, so nothing else should happen until the caller is known to
  // be within budget.
  const refused = enforce(request, "feed");
  if (refused) return refused;

  const params = new URL(request.url).searchParams;
  const requested = Number(params.get("n") ?? DEFAULT_BATCH);
  const n = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_BATCH) : DEFAULT_BATCH;

  // Absent and empty both mean "no filter". Null is passed rather than an empty
  // array so the intent is unambiguous at the SQL boundary.
  const rarities = (params.get("rarities") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  // Same rule for the price bounds: an absent parameter is "no bound", which is
  // not the same as zero and not the same as the top of the slider. A client
  // whose upper handle is parked omits max_price entirely, so the $4,500
  // Charizard stays reachable however far the catalog outgrows the UI ceiling.
  const price = (name: string): number | undefined => {
    const raw = params.get(name);
    if (raw === null || raw.trim() === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const minPrice = price("min_price");
  const maxPrice = price("max_price");

  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // The mix, the cold-start threshold and the taste math all live inside this
  // function so the weights have exactly one home. See db/migrations/0005.
  // The rarity and price filters are applied there too, so no bucket can leak an
  // unticked group or an out-of-range card — see db/migrations/0009 and 0014.
  const { data, error } = await supabase.rpc("feed_for_user", {
    p_limit: n,
    p_rarities: rarities.length > 0 ? rarities : undefined,
    p_min_price: minPrice,
    p_max_price: maxPrice,
  });
  if (error) {
    // An unknown group key or an impossible range is a client bug, not a server
    // fault: the function raises rather than returning an empty batch that would
    // look like "you have seen everything".
    const status = /unknown rarity group|price range is inverted|price must not be negative/.test(error.message)
      ? 400
      : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  const body: FeedResponse = { cards: (data ?? []) as Card[] };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
