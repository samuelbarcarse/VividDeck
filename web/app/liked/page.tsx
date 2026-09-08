import Link from "next/link";

import { AuthPanel } from "@/components/AuthPanel";
import { CardGrid } from "@/components/CardGrid";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Card } from "@/lib/types";

// Build order step 9 still owes this page: infinite scroll, the detail modal
// with a TCGplayer link, CSV export, and filtering by illustrator or set.
const PAGE_SIZE = 60;

export default async function LikedPage({ searchParams }: PageProps<"/liked">) {
  // A repeated query string (?auth_error=a&auth_error=b) arrives as an array, so
  // this cannot be typed as a plain string. Nobody reaches that URL honestly, but
  // it is trivial to construct by hand and would otherwise render "[object Array]"
  // straight into the page.
  const rawError = (await searchParams).auth_error;
  const authError = Array.isArray(rawError) ? rawError[0] : rawError;

  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;

  // `is_anonymous` is a claim on the JWT of anyone who signed in via
  // signInAnonymously. Anonymous users still hold the `authenticated` Postgres
  // role, so RLS alone does not tell these two apart — this flag is the only
  // thing that does.
  const isAnonymous = user?.is_anonymous === true;

  if (!user) {
    // No session at all, so there is nothing to upgrade: the panel must offer a
    // plain sign-in rather than an account link.
    return (
      <Shell authError={authError} anonymousSession={false}>
        Start swiping first — your likes show up here.
      </Shell>
    );
  }

  const { data, error } = await supabase
    .from("swipes")
    .select("card_id, created_at, cards(id, name, image_key, illustrator, rarity, price_usd, sets(name))")
    .eq("direction", 1)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) {
    return (
      <Shell authError={authError} email={user.email ?? null} anonymousSession={isAnonymous}>
        Could not load your likes: {error.message}
      </Shell>
    );
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

  return (
    <Shell authError={authError} email={user.email ?? null} anonymousSession={isAnonymous}>
      {/* Shown above the grid, and only once there is something to lose. An empty
          page asking for an email is easy to dismiss; the same ask sitting on top
          of art you just picked out is not. */}
      {isAnonymous && cards.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200/90">
          These aren&rsquo;t saved. You&rsquo;re browsing without an account, so this list lives only in this browser and
          is deleted after a week of inactivity. Sign in to keep it — your {cards.length} like
          {cards.length === 1 ? "" : "s"} and everything the feed has learned carry over.
        </div>
      )}
      {cards.length === 0 ? "Nothing liked yet." : <CardGrid cards={cards} />}
    </Shell>
  );
}

function Shell({
  children,
  authError,
  email = null,
  anonymousSession,
}: {
  children: React.ReactNode;
  authError?: string;
  email?: string | null;
  anonymousSession: boolean;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg text-neutral-200">Liked</h1>
          <Link href="/" className="text-sm text-neutral-500 underline-offset-4 hover:text-neutral-200 hover:underline">
            Back to swiping
          </Link>
        </div>
        <AuthPanel email={email} anonymousSession={anonymousSession} />
      </header>
      {authError && (
        <p className="mb-6 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          Sign-in failed: {authError}
        </p>
      )}
      <div className="text-neutral-500">{children}</div>
    </main>
  );
}
