import Link from "next/link";

import { AuthPanel } from "@/components/AuthPanel";
import { LikedGrid } from "@/components/LikedGrid";
import { LIKES_PAGE_SIZE, SAVE_PROMPT_MIN_LIKES, toLikesPage } from "@/lib/likes";
import { createServerSupabase } from "@/lib/supabase/server";

// Build order step 9 still owes this page: the detail modal with a TCGplayer
// link, CSV export, and filtering by illustrator or set.

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

  // The count is fetched separately rather than read off the first page, which
  // only ever holds LIKES_PAGE_SIZE rows. Sizing the save prompt off the page
  // length would have capped it at 60 and, worse, understated what the reader
  // stands to lose at exactly the moment it is asking them to protect it.
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    supabase.rpc("list_likes", { p_limit: LIKES_PAGE_SIZE }),
    supabase.from("swipes").select("card_id", { count: "exact", head: true }).eq("direction", 1),
  ]);

  if (error ?? countError) {
    return (
      <Shell authError={authError} email={user.email ?? null} anonymousSession={isAnonymous}>
        Could not load your likes: {(error ?? countError)?.message}
      </Shell>
    );
  }

  const { cards, nextCursor } = toLikesPage(data ?? [], LIKES_PAGE_SIZE);
  const totalLikes = count ?? cards.length;

  return (
    <Shell authError={authError} email={user.email ?? null} anonymousSession={isAnonymous}>
      {/* Held back until the list is worth keeping. SPEC puts this at ~20 likes:
          before that there is little to lose and the ask just gets dismissed,
          which spends the one moment this prompt gets to land. */}
      {isAnonymous && totalLikes >= SAVE_PROMPT_MIN_LIKES && (
        <div className="mb-6 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200/90">
          These aren&rsquo;t saved. You&rsquo;re browsing without an account, so this list lives only in this browser and
          is deleted after a week of inactivity. Sign in to keep it — your {totalLikes} likes and everything the feed
          has learned carry over.
        </div>
      )}
      {totalLikes === 0 ? (
        "Nothing liked yet."
      ) : (
        <LikedGrid initialCards={cards} initialCursor={nextCursor} />
      )}
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
          {/* "Watchlist" is what the top bar calls this, so it is what the page
              has to call itself. The route stays /liked: it is what the auth
              callback redirects to and what the swipes table actually records. */}
          <h1 className="text-lg font-semibold text-neutral-200">Watchlist</h1>
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
