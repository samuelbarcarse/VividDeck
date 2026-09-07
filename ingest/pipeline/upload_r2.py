#!/usr/bin/env python3
"""Stage 5 — sync processed images to Cloudflare R2.

Not yet implemented. Build order step 3.

Requirements:
  - rclone sync (resumable and parallel by default) or boto3; R2 is S3-compatible
  - Keys: cards/{card_id}/feed.webp and cards/{card_id}/detail.webp
  - Cache-Control: public, max-age=31536000, immutable — these objects never change
  - Credentials from ingest/.env (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)
"""

from __future__ import annotations

import argparse

from .common import add_common_args, setup_logging

CACHE_CONTROL = "public, max-age=31536000, immutable"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--workers", type=int, default=16, help="Parallel uploads")
    parser.add_argument("--dry-run", action="store_true", help="List what would be uploaded")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    raise SystemExit("Stage 5 is not implemented yet — see build order step 3 in SPEC.md.")


if __name__ == "__main__":
    raise SystemExit(main())
