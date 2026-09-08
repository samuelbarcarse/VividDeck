"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Sign-in and sign-out control, rendered inline on the watchlist and inside the
 * top bar's account menu.
 *
 * Anonymous visitors are *upgraded* rather than replaced. `linkIdentity` attaches
 * a Google identity to the existing `auth.users` row, so the user id survives and
 * their swipe history and taste vector come with it. Calling `signInWithOAuth`
 * instead would mint a second user and silently orphan everything they had
 * already liked, which is the failure this component exists to avoid.
 *
 * `signInLabel` exists because the two call sites are asking for different
 * things. On the watchlist the reader is looking at a list they are about to
 * lose, so the button names the stake; in the account menu there is no list on
 * screen and the same words would be a promise about nothing.
 */
export function AuthPanel({
  email,
  anonymousSession,
  signInLabel = "Save these — sign in with Google",
}: {
  email: string | null;
  anonymousSession: boolean;
  signInLabel?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/liked`;

    // Three states, not two: an anonymous session to upgrade, a signed-in user,
    // or no session at all. Only the first can be linked — calling linkIdentity
    // with nothing to link fails in a way that is easy to misread as "this Google
    // account is already taken" and would send the user down the wrong branch.
    if (anonymousSession) {
      const { error: linkError } = await supabase.auth.linkIdentity({
        provider: "google",
        options: { redirectTo },
      });
      // On success the browser has already navigated to Google and nothing below
      // runs. Reaching here means it failed.
      if (!linkError) return;

      // The common non-fatal case: this Google account is already attached to
      // another VividDeck user, which happens whenever someone signs in from a
      // second device that had started its own anonymous session. Signing in
      // normally is the right recovery — it returns them to their real account.
      // The throwaway anonymous row they are leaving behind gets reaped by the
      // purge job in db/migrations/0010.
      const alreadyLinked = /already|exists|identity/i.test(linkError.message);
      if (!alreadyLinked) {
        setError(
          /manual linking/i.test(linkError.message)
            ? "Account linking is turned off for this project. Enable Manual Linking in Supabase → Authentication → Providers."
            : linkError.message,
        );
        setBusy(false);
        return;
      }
    }

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (oauthError) {
      setError(oauthError.message);
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    await createClient().auth.signOut();
    // The deck mints a fresh anonymous session on its next load, so signing out
    // returns you to browsing rather than to a wall.
    router.push("/");
    router.refresh();
  };

  // An email is only ever present on a permanent account, so it is the signal
  // for "signed in" — an anonymous user has none by definition.
  if (email) {
    return (
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        <span className="truncate">{email}</span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="shrink-0 underline-offset-4 hover:text-neutral-300 hover:underline disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="rounded-full border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-900 disabled:opacity-50"
      >
        {busy ? "Opening Google…" : signInLabel}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-red-400">{error}</p>}
    </div>
  );
}
