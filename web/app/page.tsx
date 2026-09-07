import Link from "next/link";

import { SwipeDeck } from "@/components/SwipeDeck";
import { createServerSupabase } from "@/lib/supabase/server";
import type { RarityGroup } from "@/lib/types";

export default async function Page() {
  // Fetched here rather than from the client so the taxonomy has exactly one
  // home — the database — and the checkbox list cannot drift from the groups the
  // feed actually filters on. It also saves a round trip before the first paint.
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("rarity_groups").select("key, label").order("sort_order");

  const rarityGroups: RarityGroup[] = data ?? [];

  return (
    <main className="relative">
      <Link
        href="/liked"
        className="absolute right-4 top-4 z-10 text-sm text-neutral-500 underline-offset-4 hover:text-neutral-200 hover:underline"
      >
        Liked
      </Link>
      <SwipeDeck rarityGroups={rarityGroups} />
    </main>
  );
}
