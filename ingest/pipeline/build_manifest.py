#!/usr/bin/env python3
"""Stage 2 — flatten the raw per-set JSON into manifest.jsonl and sets.jsonl.

Prints counts and a random sample for eyeball inspection. Bad data caught here
costs minutes; caught after embedding it costs hours.
"""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from typing import Any, Iterator

from .common import (
    LANGUAGES,
    Paths,
    add_common_args,
    log,
    namespaced_id,
    paths_from_args,
    read_json,
    setup_logging,
    write_jsonl,
)

# TCGdex serves `image` as a base URL; quality and extension are appended.
# Requesting webp here avoids pulling ~360KB PNGs for 40k cards.
IMAGE_QUALITY = "high"
IMAGE_FORMAT = "webp"


def iter_raw_sets(paths: Paths, languages: list[str]) -> Iterator[dict[str, Any]]:
    for language in languages:
        directory = paths.raw_cards / language
        if not directory.is_dir():
            log.warning("No raw data for language %r — run fetch_catalog first", language)
            continue
        for path in sorted(directory.glob("*.json")):
            yield read_json(path)


def flatten(payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
    language = payload["language"]
    set_meta = payload["set"]
    set_uid = namespaced_id(language, set_meta["id"])

    set_row = {
        "id": set_uid,
        "tcgdex_id": set_meta["id"],
        "name": set_meta.get("name"),
        "series": (set_meta.get("serie") or {}).get("name"),
        "language": language,
        "release_date": set_meta.get("releaseDate"),
        "card_count": (set_meta.get("cardCount") or {}).get("total"),
    }

    rows: list[dict[str, Any]] = []
    skipped_no_image = 0
    for card in payload["cards"]:
        image_base = card.get("image")
        if not image_base:
            # No art means nothing to embed and nothing to show. The whole app is
            # the picture, so these are dropped rather than carried as null rows.
            skipped_no_image += 1
            continue
        card_uid = namespaced_id(language, card["id"])
        rows.append({
            "id": card_uid,
            "tcgdex_id": card["id"],
            "language": language,
            "set_id": set_uid,
            "set_name": set_row["name"],
            "series": set_row["series"],
            "release_date": set_row["release_date"],
            "name": card.get("name"),
            "number": card.get("localId"),
            "rarity": card.get("rarity"),
            "illustrator": card.get("illustrator"),
            "category": card.get("category"),
            "image_url": f"{image_base}/{IMAGE_QUALITY}.{IMAGE_FORMAT}",
            "image_key": f"cards/{card_uid}",
        })
    return set_row, rows, skipped_no_image


def report(cards: list[dict[str, Any]], sets: list[dict[str, Any]], skipped: int,
           sample_size: int, seed: int | None) -> None:
    illustrators = Counter(c["illustrator"] for c in cards if c["illustrator"])
    by_language = Counter(c["language"] for c in cards)
    missing_illustrator = sum(1 for c in cards if not c["illustrator"])
    missing_rarity = sum(1 for c in cards if not c["rarity"])

    print()
    print(f"  sets                 {len(sets):>7,}")
    print(f"  cards                {len(cards):>7,}")
    for language, count in sorted(by_language.items()):
        print(f"    {language:<17} {count:>7,}")
    print(f"  distinct illustrators{len(illustrators):>7,}")
    print(f"  missing illustrator  {missing_illustrator:>7,}")
    print(f"  missing rarity       {missing_rarity:>7,}")
    print(f"  dropped (no image)   {skipped:>7,}")
    print()
    print("  top illustrators:")
    for name, count in illustrators.most_common(10):
        print(f"    {count:>6,}  {name}")

    print()
    print(f"  random sample of {sample_size}:")
    rng = random.Random(seed)
    for row in rng.sample(cards, min(sample_size, len(cards))):
        print("   ", json.dumps(row, ensure_ascii=False))
    print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--languages", default=",".join(LANGUAGES),
                        help=f"Comma-separated languages to include (default: {','.join(LANGUAGES)})")
    parser.add_argument("--sample", type=int, default=20,
                        help="How many random rows to print for inspection (default: 20)")
    parser.add_argument("--seed", type=int, default=None, help="Seed the random sample for reproducible output")
    args = parser.parse_args(argv)

    setup_logging(args.verbose)
    paths = paths_from_args(args)
    languages = [lang.strip() for lang in args.languages.split(",") if lang.strip()]

    cards: list[dict[str, Any]] = []
    sets: list[dict[str, Any]] = []
    skipped_total = 0
    for payload in iter_raw_sets(paths, languages):
        set_row, rows, skipped = flatten(payload)
        sets.append(set_row)
        cards.extend(rows)
        skipped_total += skipped

    if not cards:
        raise SystemExit("No cards found. Run fetch_catalog.py first.")

    duplicates = [cid for cid, count in Counter(c["id"] for c in cards).items() if count > 1]
    if duplicates:
        raise SystemExit(f"{len(duplicates)} duplicate card ids, e.g. {duplicates[:5]}. "
                         "Every id must be unique — it is the primary key.")

    write_jsonl(paths.manifest, cards)
    write_jsonl(paths.root / "sets.jsonl", sets)
    log.info("Wrote %s and %s", paths.manifest, paths.root / "sets.jsonl")

    report(cards, sets, skipped_total, args.sample, args.seed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
