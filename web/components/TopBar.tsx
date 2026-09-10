import Link from "next/link";

/**
 * The logo bar, with a slot either side.
 *
 * A three-column grid rather than `justify-between`, because the logo has to sit
 * on the centre line of the page and not merely between its neighbours — the
 * slots hold different amounts on different pages, and flexbox would push the
 * mark visibly off-centre wherever they were unequal.
 *
 * The bar knows nothing about filters, watchlists or accounts. It used to take
 * all three, which meant the watchlist could only have the same header as the
 * deck by pretending to be the deck. Slots let both pages share the one thing
 * that actually has to be identical — the mark, its size, and its position —
 * while putting their own controls beside it.
 *
 * It sits in normal flow above the page content rather than floating over it.
 * On the deck the card is dragged by hand and can travel the full width of the
 * screen; an overlaid bar would be something the card slides underneath, and an
 * open panel would be something you have to dismiss before you can swipe again.
 */
export function TopBar({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="grid w-full shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-3 sm:gap-4 sm:px-5 sm:py-4">
      <div className="flex items-center gap-2 justify-self-start sm:gap-3">{left}</div>

      <Link
        href="/"
        aria-label="SiftTCG — home"
        className="flex items-center gap-1.5 justify-self-center sm:gap-2"
      >
        {/* A local PNG with its own alpha, not next/image: there is nothing to
            optimise and the loader would only add a request to the critical path.
            The asset is dark-mode ink — the source artwork is navy on white and
            would show as a white slab on this background.

            Icon only, with the name set in text beside it. The delivered lockup
            has its wordmark drawn as pixels, so a rename would otherwise mean
            commissioning art; this way the name lives in one string. `alt` is
            empty because the link is already labelled above — announcing the
            mark again would just make a screen reader say the name twice. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sifttcg-icon.png" alt="" className="h-5 w-auto sm:h-7" />
        <span className="text-base font-semibold tracking-tight text-foreground sm:text-xl">
          SiftTCG
        </span>
      </Link>

      <div className="flex items-center gap-2 justify-self-end sm:gap-3">{right}</div>
    </header>
  );
}
