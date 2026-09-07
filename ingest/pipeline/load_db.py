#!/usr/bin/env python3
"""Stage 7 — load sets, cards and embeddings into Postgres.

Not yet implemented. Build order step 5.

Requirements:
  - Join manifest.jsonl + embeddings.npy + card_ids.json
  - Bulk load via COPY into a temp table, then insert ... on conflict do update
  - Never row-by-row through the client
  - sets.jsonl must load before cards.jsonl (foreign key)
  - Connection string from DATABASE_URL in ingest/.env
"""

from __future__ import annotations

import argparse

from .common import add_common_args, setup_logging


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--batch-size", type=int, default=5000, help="Rows per COPY batch")
    parser.add_argument("--skip-embeddings", action="store_true",
                        help="Load metadata only — useful before stage 6 has run")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    raise SystemExit("Stage 7 is not implemented yet — see build order step 5 in SPEC.md.")


if __name__ == "__main__":
    raise SystemExit(main())
