#!/usr/bin/env python3
"""Stage 8 — refresh cards.price_usd. Weekly cadence, independent of stages 1-7.

Not yet implemented. Build order step 12.

Requirements:
  - pokemontcg.io uses a different id scheme than TCGdex, so join on
    set code + card number, never on id
  - Leave price null when there is no confident match rather than guessing

Note: TCGdex's own per-card REST response now carries TCGplayer pricing
(pricing.tcgplayer.*.marketPrice, USD). That may remove the need for
pokemontcg.io and its id-matching problem entirely. Decide before implementing.
"""

from __future__ import annotations

import argparse

from .common import add_common_args, setup_logging


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--source", choices=("tcgdex", "pokemontcg"), default="tcgdex",
                        help="Price source (default: tcgdex, which needs no id remapping)")
    parser.add_argument("--rate", type=float, default=5.0, help="Max requests/sec")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    raise SystemExit("Stage 8 is not implemented yet — see build order step 12 in SPEC.md.")


if __name__ == "__main__":
    raise SystemExit(main())
