#!/usr/bin/env python3
"""Stage 4 — derive feed and detail renditions from the downloaded originals.

Not yet implemented. Build order step 3.

Requirements:
  - Pillow; two derivatives per card, both WebP quality 80
  - feed at 600px wide (target ~40KB), detail at 1200px wide
  - Write to data/images/processed/{card_id}/{feed,detail}.webp
  - Resumable via skip-if-exists
"""

from __future__ import annotations

import argparse

from .common import add_common_args, setup_logging

FEED_WIDTH = 600
DETAIL_WIDTH = 1200
WEBP_QUALITY = 80


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--workers", type=int, default=8, help="Parallel encode workers")
    parser.add_argument("--force", action="store_true", help="Reprocess images already on disk")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    raise SystemExit("Stage 4 is not implemented yet — see build order step 3 in SPEC.md.")


if __name__ == "__main__":
    raise SystemExit(main())
