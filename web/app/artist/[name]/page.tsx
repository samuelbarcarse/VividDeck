import Link from "next/link";

import { CardGrid } from "@/components/CardGrid";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Card } from "@/lib/types";

const PAGE_SIZE = 200;

export default async function ArtistPage({ params }: PageProps<"/artist/[name]">) {
  const { name } = await params;
  const illustrator = decodeURIComponent(name);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("cards")
    .select("id, name, image_key, illustrator, rarity, price_usd, sets(name)")
    .eq("illustrator", illustrator)
    .limit(PAGE_SIZE);

  if (error) {
    return <Shell illustrator={illustrator}>Could not load this artist: {error.message}</Shell>;
  }

  const cards: Card[] = (data ?? []).map((card) => ({
    id: card.id,
    name: card.name,
    image_key: card.image_key,
    illustrator: card.illustrator,
    rarity: card.rarity,
    price_usd: card.price_usd,
    set_name: card.sets?.name ?? null,
  }));

  return (
    <Shell illustrator={illustrator}>
      {cards.length === 0 ? "No cards found for this illustrator." : <CardGrid cards={cards} />}
    </Shell>
  );
}

function Shell({ illustrator, children }: { illustrator: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-lg text-neutral-200">{illustrator}</h1>
        <Link href="/" className="text-sm text-neutral-500 underline-offset-4 hover:text-neutral-200 hover:underline">
          Back to swiping
        </Link>
      </header>
      <div className="text-neutral-500">{children}</div>
    </main>
  );
}
