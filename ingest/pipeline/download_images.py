#!/usr/bin/env python3
"""Stage 3 — download every card image in the manifest.

Reads image_url from manifest.jsonl and writes data/images/original/{card_id}.webp.
Skips files already on disk, so an interrupted run resumes for free. Failures are
recorded to the log and the run continues — across the full catalog this stage runs
for hours and must be safe to leave unattended.
"""

from __future__ import annotations

import argparse
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests

from .common import (
    DEFAULT_RATE_LIMIT,
    Paths,
    RateLimiter,
    add_common_args,
    log,
    paths_from_args,
    read_jsonl,
    record_failure,
    failure_logger,
    sanitize,
    setup_logging,
)

# TCGdex serves a truncated body rather than a 404 for some missing assets, so a
# suspiciously small file is treated as a failure instead of being cached forever.
MIN_IMAGE_BYTES = 1024


def original_path(paths: Paths, card_id: str) -> Path:
    return paths.images_original / f"{sanitize(card_id)}.webp"


def download_one(
    session: requests.Session,
    limiter: RateLimiter,
    url: str,
    destination: Path,
    max_retries: int,
) -> int:
    """Download to a temp file then rename, so a partial file is never mistaken
    for a completed one by the next run's skip-if-exists check."""
    last_error: Exception | None = None
    for attempt in range(max_retries):
        limiter.acquire()
        try:
            response = session.get(url, timeout=60)
            if response.status_code == 404:
                raise FileNotFoundError(f"404 {url}")
            response.raise_for_status()
            body = response.content
            if len(body) < MIN_IMAGE_BYTES:
                raise ValueError(f"body only {len(body)} bytes")
            destination.parent.mkdir(parents=True, exist_ok=True)
            tmp = destination.with_suffix(".webp.tmp")
            tmp.write_bytes(body)
            tmp.replace(destination)
            return len(body)
        except FileNotFoundError:
            raise
        except (requests.RequestException, ValueError, OSError) as exc:
            last_error = exc
            if attempt == max_retries - 1:
                break
            time.sleep(min(30.0, 2**attempt))
    raise RuntimeError(f"failed after {max_retries} attempts: {last_error}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--rate", type=float, default=DEFAULT_RATE_LIMIT, help="Max requests/sec")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent downloads")
    parser.add_argument("--limit", type=int, default=None, help="Download at most N images")
    parser.add_argument("--force", action="store_true", help="Redownload images already on disk")
    parser.add_argument("--languages", nargs="+", default=None,
                        help="Restrict to these manifest languages (default: all)")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    paths = paths_from_args(args)

    if not paths.manifest.exists():
        raise SystemExit(f"No manifest at {paths.manifest} — run build_manifest.py first.")

    rows: list[dict[str, Any]] = list(read_jsonl(paths.manifest))
    if args.languages:
        wanted = set(args.languages)
        rows = [r for r in rows if r["language"] in wanted]

    pending = []
    already = 0
    for row in rows:
        destination = original_path(paths, row["id"])
        if destination.exists() and not args.force:
            already += 1
            continue
        pending.append((row["id"], row["image_url"], destination))

    if args.limit is not None:
        pending = pending[: args.limit]

    log.info("%d images in manifest, %d already on disk, %d to download",
             len(rows), already, len(pending))
    if not pending:
        return 0

    failures = failure_logger(paths, "download_images")
    limiter = RateLimiter(args.rate)
    session = requests.Session()
    session.headers["User-Agent"] = "sifttcg-ingest/0.1"

    downloaded = 0
    failed = 0
    total_bytes = 0
    started = time.monotonic()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(download_one, session, limiter, url, destination, 5): card_id
            for card_id, url, destination in pending
        }
        for done in as_completed(futures):
            card_id = futures[done]
            try:
                total_bytes += done.result()
                downloaded += 1
            except Exception as exc:
                failed += 1
                record_failure(failures, card_id, str(exc))
                log.warning("%s: %s", card_id, exc)

            if (downloaded + failed) % 200 == 0:
                elapsed = time.monotonic() - started
                rate = (downloaded + failed) / elapsed if elapsed else 0
                log.info("%d/%d done (%.1f/s)", downloaded + failed, len(pending), rate)

    elapsed = time.monotonic() - started
    log.info("Downloaded %d images (%.1f MB) in %.1fs; %d failed",
             downloaded, total_bytes / 1e6, elapsed, failed)
    if failed:
        log.info("Failures logged to %s", failures)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
