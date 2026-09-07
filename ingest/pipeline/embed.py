#!/usr/bin/env python3
"""Stage 6 — CLIP embeddings for every processed feed image.

Not yet implemented. Build order step 3.

Requirements:
  - CLIP ViT-B/32 via open_clip, batches of 256
  - Unit-normalize so cosine similarity is a plain dot product
  - Write embeddings.npy and card_ids.json in matching order

An off-by-one between those two files silently corrupts every recommendation
and is nearly impossible to debug later. Before writing: assert the lengths
match and spot-check three known cards.
"""

from __future__ import annotations

import argparse

from .common import add_common_args, setup_logging

MODEL = "ViT-B-32"
PRETRAINED = "laion2b_s34b_b79k"
EMBEDDING_DIM = 512
BATCH_SIZE = 256


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help=f"Images per batch (default: {BATCH_SIZE})")
    parser.add_argument("--device", default=None, help="torch device (default: cuda if available, else cpu)")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    raise SystemExit("Stage 6 is not implemented yet — see build order step 3 in SPEC.md.")


if __name__ == "__main__":
    raise SystemExit(main())
