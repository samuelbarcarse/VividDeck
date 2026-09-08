import { SwipeDeck } from "@/components/SwipeDeck";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Account, RarityGroup } from "@/lib/types";

export default async function Page() {
  const supabase = await createServerSupabase();

  // The rarity taxonomy is fetched here rather than from the client so it has
  // exactly one home — the database — and the checkbox list cannot drift from
  // the groups the feed actually filters on. It also saves a round trip before
  // the first paint. The user is read alongside it because the top bar shows an
  // avatar, and resolving that on the client would flash a stranger's account
  // control at a signed-in reader.
  const [{ data }, { data: auth }] = await Promise.all([
    supabase.from("rarity_groups").select("key, label").order("sort_order"),
    supabase.auth.getUser(),
  ]);

  const rarityGroups: RarityGroup[] = data ?? [];
  const user = auth.user;

  const account: Account = {
    // Only ever present on a permanent account, so it doubles as the "signed in"
    // signal; see AuthPanel.
    email: user?.email ?? null,
    // Google puts this in the identity's metadata. It is typed as free-form
    // JSON, so anything that is not a string is treated as absent rather than
    // handed to an <img src>.
    avatarUrl: typeof user?.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null,
    // `is_anonymous` is a JWT claim. Anonymous users hold the same
    // `authenticated` Postgres role as everyone else, so nothing else tells
    // these two apart — and only an anonymous session can be *linked* to a
    // Google identity rather than replaced by one.
    anonymousSession: user?.is_anonymous === true,
  };

  return <SwipeDeck rarityGroups={rarityGroups} account={account} />;
}
