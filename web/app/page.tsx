import Link from "next/link";

import { SwipeDeck } from "@/components/SwipeDeck";

export default function Page() {
  return (
    <main className="relative">
      <Link
        href="/liked"
        className="absolute right-4 top-4 z-10 text-sm text-neutral-500 underline-offset-4 hover:text-neutral-200 hover:underline"
      >
        Liked
      </Link>
      <SwipeDeck />
    </main>
  );
}
