import Link from "next/link";

import { CardGrid } from "@/components/CardGrid";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Card } from "@/lib/types";

// Build order step 9 still owes this page: infinite scroll, the detail modal
// with a TCGplayer link, CSV export, and filtering by illustrator or set.
const PAGE_SIZE = 60;

export default async function LikedPage() {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return <Shell>Start swiping first — your likes show up here.</Shell>;
  }

  const { data, error } = await supabase
    .from("swipes")
    .select("card_id, created_at, cards(id, name, image_key, illustrator, rarity, price_usd, sets(name))")
    .eq("direction", 1)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) {
    return <Shell>Could not load your likes: {error.message}</Shell>;
  }

  const cards: Card[] = (data ?? [])
    .flatMap((row) => (row.cards ? [row.cards] : []))
    .map((card) => ({
      id: card.id,
      name: card.name,
      image_key: card.image_key,
      illustrator: card.illustrator,
      rarity: card.rarity,
      price_usd: card.price_usd,
      set_name: card.sets?.name ?? null,
    }));

  if (cards.length === 0) {
    return <Shell>Nothing liked yet.</Shell>;
  }

  return (
    <Shell>
      <CardGrid cards={cards} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-lg text-neutral-200">Liked</h1>
        <Link href="/" className="text-sm text-neutral-500 underline-offset-4 hover:text-neutral-200 hover:underline">
          Back to swiping
        </Link>
      </header>
      <div className="text-neutral-500">{children}</div>
    </main>
  );
}
