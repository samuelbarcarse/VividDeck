"use client";

import { useCallback, useRef, useState } from "react";

import { useDismiss } from "@/lib/useDismiss";

import { AuthPanel } from "./AuthPanel";

/**
 * The circular account control at the right of the top bar.
 *
 * Purely a container: every decision about signing in, linking an anonymous
 * session, and signing out stays in AuthPanel, which is also what the liked view
 * renders inline. This exists because the top bar has room for an avatar and not
 * for a sentence.
 *
 * Anonymous visitors have no avatar and no email, which is not an error state —
 * it is most of the traffic. They get a neutral glyph that opens the same panel,
 * so the way to a permanent account is one click from the deck rather than
 * something you only find by visiting the watchlist first.
 */
export function AccountMenu({
  email,
  avatarUrl,
  anonymousSession,
}: {
  email: string | null;
  avatarUrl: string | null;
  anonymousSession: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useDismiss(
    open,
    container,
    useCallback(() => setOpen(false), []),
  );

  // Google serves these from lh3.googleusercontent.com and does return 403 for
  // some accounts. Falling back to the initial keeps a broken image icon, which
  // looks like a bug, out of the bar.
  const showAvatar = avatarUrl !== null && !avatarFailed;
  const initial = email?.trim().charAt(0).toUpperCase() || null;

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={email ? `Account — ${email}` : "Account"}
        title={email ?? "Browsing without an account"}
        className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border border-neutral-700 bg-neutral-900 text-sm font-semibold text-neutral-300 transition-colors hover:border-neutral-500 sm:h-9 sm:w-9"
      >
        {showAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          (initial ?? <PersonGlyph />)
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-neutral-800 bg-neutral-950/95 p-3 shadow-2xl shadow-black/60 backdrop-blur">
          <AuthPanel email={email} anonymousSession={anonymousSession} signInLabel="Sign in with Google" />
        </div>
      )}
    </div>
  );
}

function PersonGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 text-neutral-500" fill="currentColor">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.6 20a7.4 7.4 0 0 1 14.8 0Z" />
    </svg>
  );
}
