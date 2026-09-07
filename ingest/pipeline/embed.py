#!/usr/bin/env python3
"""Stage 6 — CLIP embeddings for every processed feed image.

CLIP ViT-B/32 over the feed renditions, unit-normalized so cosine similarity is a
plain dot product. Writes embeddings.npy and card_ids.json in matching order.

An off-by-one between those two files silently corrupts every recommendation and is
nearly impossible to debug later: nothing errors, the feed just quietly returns the
wrong cards. Both files are therefore written from a single ordered list, the lengths
are asserted equal, and three known cards are re-embedded and compared before the
write happens.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from .common import (
    Paths,
    add_common_args,
    log,
    paths_from_args,
    read_jsonl,
    sanitize,
    setup_logging,
    write_json,
)

MODEL = "ViT-B-32"
PRETRAINED = "laion2b_s34b_b79k"
EMBEDDING_DIM = 512
BATCH_SIZE = 256
SPOT_CHECK_COUNT = 3


def feed_image(paths: Paths, card_id: str) -> Path:
    return paths.images_processed / sanitize(card_id) / "feed.webp"


def pick_device(requested: str | None) -> str:
    if requested:
        return requested
    return "cuda" if torch.cuda.is_available() else "cpu"


def embed_batch(model, preprocess, device: str, image_paths: list[Path]) -> np.ndarray:
    tensors = []
    for path in image_paths:
        with Image.open(path) as image:
            tensors.append(preprocess(image.convert("RGB")))
    batch = torch.stack(tensors).to(device)
    with torch.no_grad():
        features = model.encode_image(batch)
        features /= features.norm(dim=-1, keepdim=True)
    return features.cpu().numpy().astype(np.float32)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help=f"Images per batch (default: {BATCH_SIZE})")
    parser.add_argument("--device", default=None, help="torch device (default: cuda if available, else cpu)")
    parser.add_argument("--limit", type=int, default=None, help="Embed at most N cards")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    paths = paths_from_args(args)

    if not paths.manifest.exists():
        raise SystemExit(f"No manifest at {paths.manifest} — run build_manifest.py first.")

    # Manifest order is the single source of truth for the id/vector pairing.
    card_ids: list[str] = []
    image_paths: list[Path] = []
    missing = 0
    for row in read_jsonl(paths.manifest):
        path = feed_image(paths, row["id"])
        if not path.exists():
            missing += 1
            continue
        card_ids.append(row["id"])
        image_paths.append(path)

    if args.limit is not None:
        card_ids = card_ids[: args.limit]
        image_paths = image_paths[: args.limit]

    if not card_ids:
        raise SystemExit("No processed feed images found — run process_images.py first.")
    log.info("Embedding %d cards (%d have no feed image yet)", len(card_ids), missing)

    import open_clip

    device = pick_device(args.device)
    log.info("Loading %s / %s on %s", MODEL, PRETRAINED, device)
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL, pretrained=PRETRAINED)
    model = model.to(device).eval()

    vectors = np.zeros((len(card_ids), EMBEDDING_DIM), dtype=np.float32)
    started = time.monotonic()
    for start in range(0, len(image_paths), args.batch_size):
        chunk = image_paths[start : start + args.batch_size]
        vectors[start : start + len(chunk)] = embed_batch(model, preprocess, device, chunk)
        done = start + len(chunk)
        elapsed = time.monotonic() - started
        log.info("%d/%d embedded (%.1f img/s)", done, len(card_ids), done / elapsed if elapsed else 0)

    if len(card_ids) != vectors.shape[0]:
        raise SystemExit(f"Length mismatch: {len(card_ids)} ids vs {vectors.shape[0]} vectors")
    if vectors.shape[1] != EMBEDDING_DIM:
        raise SystemExit(f"Expected {EMBEDDING_DIM}-dim vectors, got {vectors.shape[1]}")

    norms = np.linalg.norm(vectors, axis=1)
    if not np.allclose(norms, 1.0, atol=1e-3):
        raise SystemExit(f"Vectors are not unit-normalized (min {norms.min():.4f}, max {norms.max():.4f})")

    # Spot-check: re-embed a few cards independently and confirm the vector sitting
    # at that index really belongs to that card. This is what catches an off-by-one.
    step = max(1, len(card_ids) // SPOT_CHECK_COUNT)
    for index in list(range(0, len(card_ids), step))[:SPOT_CHECK_COUNT]:
        fresh = embed_batch(model, preprocess, device, [image_paths[index]])[0]
        similarity = float(np.dot(fresh, vectors[index]))
        log.info("Spot check %-24s index %-6d self-similarity %.4f", card_ids[index], index, similarity)
        if similarity < 0.99:
            raise SystemExit(
                f"Spot check failed for {card_ids[index]} at index {index}: "
                f"self-similarity {similarity:.4f}. The id/vector order is wrong."
            )

    paths.embeddings.parent.mkdir(parents=True, exist_ok=True)
    tmp = paths.embeddings.with_suffix(".npy.tmp")
    # np.save appends ".npy" unless it is handed an open file object.
    with tmp.open("wb") as handle:
        np.save(handle, vectors)
    tmp.replace(paths.embeddings)
    write_json(paths.card_ids, card_ids)

    log.info("Wrote %s %s and %s", paths.embeddings, vectors.shape, paths.card_ids)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
