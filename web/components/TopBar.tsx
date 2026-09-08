"use client";

import Link from "next/link";

import type { RarityGroup } from "@/lib/types";
import { PILL } from "@/lib/ui";

import { AccountMenu } from "./AccountMenu";
import { RarityFilter } from "./RarityFilter";

/** Everything the bar needs to know about who is looking. */
export interface Account {
  email: string | null;
  avatarUrl: string | null;
  anonymousSession: boolean;
}

/**
 * Filter · logo · Watchlist · account.
 *
 * A three-column grid rather than `justify-between`, because the logo has to sit
 * on the centre line of the page and not merely between its neighbours — the
 * left group is one short pill and the right group is a pill plus an avatar, so
 * flexbox would push the mark visibly off-centre.
 *
 * The bar sits in normal flow above the deck rather than floating over it. The
 * card is dragged by hand and can travel the full width of the screen; an
 * overlaid bar would be something the card slides underneath, and the filter
 * panel would be something you have to dismiss before you can swipe again.
 */
export function TopBar({
  rarityGroups,
  rarities,
  onRaritiesChange,
  account,
}: {
  rarityGroups: RarityGroup[];
  rarities: string[];
  onRaritiesChange: (next: string[]) => void;
  account: Account;
}) {
  return (
    <header className="grid w-full shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-3 sm:gap-4 sm:px-5 sm:py-4">
      <div className="justify-self-start">
        <RarityFilter groups={rarityGroups} selected={rarities} onChange={onRaritiesChange} />
      </div>

      <Link href="/" aria-label="VividDeck — home" className="justify-self-center">
        {/* A local PNG with its own alpha, not next/image: there is nothing to
            optimise and the loader would only add a request to the critical path.
            The asset is a dark-mode lockup — the source artwork is navy on white
            and would show as a white slab on this background. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/vividdeck-logo.png" alt="VividDeck" className="h-5 w-auto sm:h-7" />
      </Link>

      <div className="flex items-center gap-2 justify-self-end sm:gap-3">
        <Link href="/liked" className={PILL}>
          Watchlist
        </Link>
        <AccountMenu
          email={account.email}
          avatarUrl={account.avatarUrl}
          anonymousSession={account.anonymousSession}
        />
      </div>
    </header>
  );
}
