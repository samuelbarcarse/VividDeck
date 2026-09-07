#!/usr/bin/env python3
"""Stage 5 — sync processed images to Cloudflare R2.

boto3 against R2's S3-compatible endpoint. Keys are cards/{card_id}/feed.webp and
cards/{card_id}/detail.webp, matching the image_key column in the manifest.

Objects are immutable — a given card's art never changes — so they carry a one-year
immutable Cache-Control and the uploader skips any key already present in the bucket.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from .common import (
    Paths,
    add_common_args,
    failure_logger,
    log,
    paths_from_args,
    read_jsonl,
    record_failure,
    require_env,
    sanitize,
    setup_logging,
)

CACHE_CONTROL = "public, max-age=31536000, immutable"
CONTENT_TYPE = "image/webp"
RENDITIONS = ("feed", "detail")


def build_client(env: dict[str, str]) -> Any:
    import boto3
    from botocore.config import Config

    endpoint = env.get("R2_ENDPOINT") or f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        # R2 ignores the region but boto3 requires one to sign the request.
        region_name="auto",
        config=Config(retries={"max_attempts": 5, "mode": "standard"}),
    )


def existing_keys(client: Any, bucket: str) -> set[str]:
    """One paginated LIST is far cheaper than a HEAD per object."""
    keys: set[str] = set()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix="cards/"):
        for obj in page.get("Contents", []):
            keys.add(obj["Key"])
    return keys


def upload_one(client: Any, bucket: str, source: Path, key: str) -> int:
    client.upload_file(
        str(source),
        bucket,
        key,
        ExtraArgs={"ContentType": CONTENT_TYPE, "CacheControl": CACHE_CONTROL},
    )
    return source.stat().st_size


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--workers", type=int, default=16, help="Parallel uploads")
    parser.add_argument("--dry-run", action="store_true", help="List what would be uploaded")
    parser.add_argument("--force", action="store_true", help="Reupload keys already in the bucket")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    paths: Paths = paths_from_args(args)

    if not paths.manifest.exists():
        raise SystemExit(f"No manifest at {paths.manifest} — run build_manifest.py first.")

    env = require_env("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
    bucket = env["R2_BUCKET"]

    candidates: list[tuple[str, Path, str]] = []
    missing = 0
    for row in read_jsonl(paths.manifest):
        card_dir = paths.images_processed / sanitize(row["id"])
        for rendition in RENDITIONS:
            source = card_dir / f"{rendition}.webp"
            if not source.exists():
                missing += 1
                continue
            candidates.append((row["id"], source, f"{row['image_key']}/{rendition}.webp"))

    if not candidates:
        raise SystemExit("Nothing to upload — run process_images.py first.")

    client = build_client(env)
    present = set() if args.force else existing_keys(client, bucket)
    pending = [c for c in candidates if c[2] not in present]

    log.info("%d renditions on disk (%d not processed yet), %d already in %s, %d to upload",
             len(candidates), missing, len(candidates) - len(pending), bucket, len(pending))

    if args.dry_run:
        for _, source, key in pending[:20]:
            log.info("would upload %s -> %s", source, key)
        if len(pending) > 20:
            log.info("... and %d more", len(pending) - 20)
        return 0

    if not pending:
        return 0

    failures = failure_logger(paths, "upload_r2")
    uploaded = 0
    failed = 0
    total_bytes = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(upload_one, client, bucket, source, key): key
                   for _, source, key in pending}
        for done in as_completed(futures):
            key = futures[done]
            try:
                total_bytes += done.result()
                uploaded += 1
            except Exception as exc:
                failed += 1
                record_failure(failures, key, str(exc))
                log.warning("%s: %s", key, exc)

            if (uploaded + failed) % 200 == 0:
                log.info("%d/%d uploaded", uploaded + failed, len(pending))

    log.info("Uploaded %d objects (%.1f MB), %d failed", uploaded, total_bytes / 1e6, failed)
    if failed:
        log.info("Failures logged to %s", failures)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
