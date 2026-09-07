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
import json
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


def load_cache(paths: Paths) -> dict[str, np.ndarray]:
    """Existing vectors keyed by card id, so a top-up only embeds what is new.

    Keyed by id rather than position because the manifest reorders whenever a set
    is added; trusting the old index would silently pair cards with the wrong
    vectors, which is the exact failure this stage is built to prevent.
    """
    ids_path = paths.root / "card_ids.json"
    if not paths.embeddings.exists() or not ids_path.exists():
        return {}
    try:
        vectors = np.load(paths.embeddings)
        cached_ids = json.loads(ids_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        log.warning("Ignoring unreadable embedding cache (%s); re-embedding everything", exc)
        return {}

    if len(cached_ids) != vectors.shape[0] or vectors.shape[1] != EMBEDDING_DIM:
        log.warning("Embedding cache is inconsistent (%d ids vs %s vectors); re-embedding everything",
                    len(cached_ids), vectors.shape)
        return {}
    return {card_id: vectors[i] for i, card_id in enumerate(cached_ids)}


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
    parser.add_argument("--force", action="store_true",
                        help="Re-embed every card instead of reusing embeddings.npy")
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

    cache = {} if args.force else load_cache(paths)
    vectors = np.zeros((len(card_ids), EMBEDDING_DIM), dtype=np.float32)
    todo: list[int] = []
    for index, card_id in enumerate(card_ids):
        cached = cache.get(card_id)
        if cached is None:
            todo.append(index)
        else:
            vectors[index] = cached

    log.info("Embedding %d cards (%d reused from cache, %d have no feed image yet)",
             len(todo), len(card_ids) - len(todo), missing)

    # The model loads even when nothing needs embedding: the spot check below
    # re-embeds three cards, and on a cache-reuse run that check is the only thing
    # proving the cached vectors are still paired with the right ids.
    import open_clip

    device = pick_device(args.device)
    log.info("Loading %s / %s on %s", MODEL, PRETRAINED, device)
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL, pretrained=PRETRAINED)
    model = model.to(device).eval()

    if todo:
        started = time.monotonic()
        for start in range(0, len(todo), args.batch_size):
            indices = todo[start : start + args.batch_size]
            vectors[indices] = embed_batch(model, preprocess, device, [image_paths[i] for i in indices])
            done = start + len(indices)
            elapsed = time.monotonic() - started
            log.info("%d/%d embedded (%.1f img/s)", done, len(todo), done / elapsed if elapsed else 0)

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
