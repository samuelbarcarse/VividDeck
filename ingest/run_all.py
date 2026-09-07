#!/usr/bin/env python3
"""Orchestrator — chains the ingest stages in order.

Every stage also runs standalone; this only saves typing. Because each stage
skips work already on disk, re-running the whole chain after a new set drops
only does real work for the new cards, which is what --incremental means here.

  python run_all.py --incremental
  python run_all.py --from 3 --to 6
"""

from __future__ import annotations

import argparse
import sys
import time

from pipeline import (
    build_manifest,
    download_images,
    embed,
    fetch_catalog,
    load_db,
    process_images,
    upload_r2,
)
from pipeline.common import log, setup_logging

# Stage 8 is deliberately absent: prices run on their own weekly cadence.
STAGES = [
    (1, "fetch_catalog", fetch_catalog.main),
    (2, "build_manifest", build_manifest.main),
    (3, "download_images", download_images.main),
    (4, "process_images", process_images.main),
    (5, "upload_r2", upload_r2.main),
    (6, "embed", embed.main),
    (7, "load_db", load_db.main),
]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from", dest="start", type=int, default=1, help="First stage to run (default: 1)")
    parser.add_argument("--to", dest="end", type=int, default=7, help="Last stage to run (default: 7)")
    parser.add_argument("--incremental", action="store_true",
                        help="Documentation flag: every stage is already skip-if-done")
    parser.add_argument("--verbose", "-v", action="store_true")
    args, passthrough = parser.parse_known_args(argv)

    setup_logging(args.verbose)
    if args.verbose:
        passthrough.append("--verbose")

    for number, name, entry in STAGES:
        if not args.start <= number <= args.end:
            continue
        log.info("=== stage %d: %s ===", number, name)
        started = time.monotonic()
        code = entry(passthrough)
        if code:
            log.error("stage %d (%s) exited %d — stopping", number, name, code)
            return code
        log.info("=== stage %d: %s done in %.1fs ===", number, name, time.monotonic() - started)
    return 0


if __name__ == "__main__":
    sys.exit(main())
