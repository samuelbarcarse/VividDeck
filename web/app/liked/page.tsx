import Link from "next/link";

import { AccountMenu } from "@/components/AccountMenu";
import { TopBar } from "@/components/TopBar";
import { Watchlist } from "@/components/Watchlist";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Account } from "@/lib/types";
import { PILL } from "@/lib/ui";
import { SAVE_PROMPT_MIN_LIKES, toWatchlist } from "@/lib/watchlist";

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

  const account: Account = {
    email: user?.email ?? null,
    avatarUrl: typeof user?.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null,
    // `is_anonymous` is a claim on the JWT of anyone who signed in via
    // signInAnonymously. Anonymous users still hold the `authenticated` Postgres
    // role, so RLS alone does not tell these two apart — this flag is the only
    // thing that does.
    anonymousSession: user?.is_anonymous === true,
  };

  if (!user) {
    return (
      <Shell account={account} authError={authError}>
        <p className="py-10 text-center text-neutral-500">Start swiping first — your likes show up here.</p>
      </Shell>
    );
  }

  // One query, the whole list. No count alongside it: the rows are already all
  // here, so a separate `count: exact` would be a second round trip to learn
  // something `cards.length` already knows.
  const { data, error } = await supabase.rpc("list_watchlist");

  if (error) {
    return (
      <Shell account={account} authError={authError}>
        <p className="py-10 text-center text-neutral-500">Could not load your watchlist: {error.message}</p>
      </Shell>
    );
  }

  const cards = toWatchlist(data ?? []);

  return (
    <Shell account={account} authError={authError} count={cards.length}>
      {/* Held back until the list is worth keeping. SPEC puts this at ~20 likes:
          before that there is little to lose and the ask just gets dismissed,
          which spends the one moment this prompt gets to land. */}
      {account.anonymousSession && cards.length >= SAVE_PROMPT_MIN_LIKES && (
        <div className="mb-6 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200/90">
          These aren&rsquo;t saved. You&rsquo;re browsing without an account, so this list lives only in this browser and
          is deleted after a week of inactivity. Sign in to keep it — your {cards.length} likes and everything the feed
          has learned carry over.
        </div>
      )}
      <Watchlist initial={cards} />
    </Shell>
  );
}

/**
 * The same logo bar as the deck, then the page.
 *
 * The bar's slots are the mirror of the deck's: there, the right-hand pill sends
 * you here; here, the left-hand one sends you back. The account control keeps
 * its position across both, which is the point of sharing the bar at all —
 * this page used to render its own header and its own inline AuthPanel, so the
 * way to sign in moved depending on which page you were on.
 */
function Shell({
  children,
  account,
  authError,
  count,
}: {
  children: React.ReactNode;
  account: Account;
  authError?: string;
  count?: number;
}) {
  return (
    <div className="min-h-dvh w-full">
      <TopBar
        left={
          <Link href="/" className={PILL}>
            Swipe
          </Link>
        }
        right={
          <AccountMenu
            email={account.email}
            avatarUrl={account.avatarUrl}
            anonymousSession={account.anonymousSession}
          />
        }
      />

      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6">
        {/* "Watchlist" is what the top bar calls this, so it is what the page
            has to call itself. The route stays /liked: it is what the auth
            callback redirects to and what the swipes table actually records. */}
        <h1 className="mb-5 flex items-baseline gap-2 text-lg font-semibold text-neutral-200">
          Watchlist
          {count !== undefined && count > 0 && (
            <span className="text-sm font-normal tabular-nums text-neutral-600">
              {count.toLocaleString("en-US")} {count === 1 ? "card" : "cards"}
            </span>
          )}
        </h1>

        {authError && (
          <p className="mb-6 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            Sign-in failed: {authError}
          </p>
        )}

        {children}
      </main>
    </div>
  );
}
