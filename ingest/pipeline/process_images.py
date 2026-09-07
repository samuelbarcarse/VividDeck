#!/usr/bin/env python3
"""Stage 4 — derive feed and detail renditions from the downloaded originals.

Two WebP derivatives per card, written to data/images/processed/{card_id}/.

The spec asks for detail at 1200px, but TCGdex's largest asset is `high` at
600x825 — `max`, `full` and `xhigh` all 404. Upscaling would only invent pixels,
so both renditions are native width and differ by quality instead: feed is
compressed for the prefetch queue (20 images in flight at once), detail keeps as
much fidelity as the source has for the modal.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

from .common import (
    Paths,
    add_common_args,
    failure_logger,
    log,
    paths_from_args,
    read_jsonl,
    record_failure,
    sanitize,
    setup_logging,
)

FEED_WIDTH = 600
DETAIL_WIDTH = 600

# The spec targets ~40KB feed images. That assumed downscaling from a larger
# source; from a native 600px original it needs q50, which visibly bands on foil
# art. q65 lands around 50KB, which the prefetch queue absorbs comfortably.
FEED_QUALITY = 65
DETAIL_QUALITY = 90

RENDITIONS = (("feed", FEED_WIDTH, FEED_QUALITY), ("detail", DETAIL_WIDTH, DETAIL_QUALITY))


def processed_dir(paths: Paths, card_id: str) -> Path:
    return paths.images_processed / sanitize(card_id)


def render(source: Path, destination_dir: Path) -> dict[str, int]:
    """Write both renditions. Returns bytes written per rendition name."""
    written: dict[str, int] = {}
    with Image.open(source) as image:
        image = image.convert("RGB")
        for name, width, quality in RENDITIONS:
            # Never upscale: a source narrower than the target stays as-is rather
            # than being blown up into a blurry file that is larger than the original.
            target_width = min(width, image.width)
            if target_width == image.width:
                resized = image
            else:
                height = round(image.height * target_width / image.width)
                resized = image.resize((target_width, height), Image.LANCZOS)

            destination_dir.mkdir(parents=True, exist_ok=True)
            destination = destination_dir / f"{name}.webp"
            tmp = destination.with_suffix(".webp.tmp")
            resized.save(tmp, "WEBP", quality=quality, method=6)
            tmp.replace(destination)
            written[name] = destination.stat().st_size
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--workers", type=int, default=8, help="Parallel encode workers")
    parser.add_argument("--force", action="store_true", help="Reprocess images already on disk")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N cards")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    paths = paths_from_args(args)

    if not paths.manifest.exists():
        raise SystemExit(f"No manifest at {paths.manifest} — run build_manifest.py first.")

    pending: list[tuple[str, Path, Path]] = []
    already = 0
    missing_source = 0

    for row in read_jsonl(paths.manifest):
        card_id = row["id"]
        source = paths.images_original / f"{sanitize(card_id)}.webp"
        if not source.exists():
            missing_source += 1
            continue
        out_dir = processed_dir(paths, card_id)
        if not args.force and all((out_dir / f"{n}.webp").exists() for n, _, _ in RENDITIONS):
            already += 1
            continue
        pending.append((card_id, source, out_dir))

    if args.limit is not None:
        pending = pending[: args.limit]

    log.info("%d already processed, %d to process, %d originals not downloaded yet",
             already, len(pending), missing_source)
    if not pending:
        return 0

    failures = failure_logger(paths, "process_images")
    processed = 0
    failed = 0
    feed_bytes = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(render, source, out_dir): card_id
                   for card_id, source, out_dir in pending}
        for done in as_completed(futures):
            card_id = futures[done]
            try:
                feed_bytes += done.result()["feed"]
                processed += 1
            except Exception as exc:
                failed += 1
                record_failure(failures, card_id, str(exc))
                log.warning("%s: %s", card_id, exc)

            if (processed + failed) % 200 == 0:
                log.info("%d/%d processed", processed + failed, len(pending))

    log.info("Processed %d cards, %d failed", processed, failed)
    if processed:
        # The spec targets ~40KB feed images; a mean well above that means the
        # swipe queue will stutter on mobile no matter how good the prefetch is.
        log.info("Mean feed image: %.1f KB", feed_bytes / processed / 1024)
    if failed:
        log.info("Failures logged to %s", failures)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
