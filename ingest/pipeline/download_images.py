#!/usr/bin/env python3
"""Stage 3 — download every card image in the manifest.

Not yet implemented. Build order step 3.

Requirements:
  - Read image_url from manifest.jsonl, write to data/images/original/{card_id}.webp
  - Resumable via skip-if-exists; exponential backoff on failure
  - Cards whose download fails are recorded to the failure log, not fatal
  - Runs for hours across the full catalog — must be safe to leave unattended
"""

from __future__ import annotations

import argparse

from .common import DEFAULT_RATE_LIMIT, add_common_args, setup_logging


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--rate", type=float, default=DEFAULT_RATE_LIMIT, help="Max requests/sec")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent downloads")
    parser.add_argument("--limit", type=int, default=None, help="Download at most N images")
    parser.add_argument("--force", action="store_true", help="Redownload images already on disk")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    raise SystemExit("Stage 3 is not implemented yet — see build order step 3 in SPEC.md.")


if __name__ == "__main__":
    raise SystemExit(main())
