#!/usr/bin/env python3
"""Build order step 4 checkpoint — nearest neighbors as an HTML contact sheet.

Reads embeddings.npy / card_ids.json / manifest.jsonl and writes an HTML page
showing a query card beside its N nearest neighbors, so the recommendation quality
can be judged by eye before committing to the full catalog ingest.

If the neighbors don't look like cards you'd want next, the concept fails and no
amount of UI work fixes it. That is the whole point of doing this on 5 sets.

    python neighbors.py --card en-base1-4
    python neighbors.py --random 8 --open

Images are referenced from the local processed directory, so this works before
anything has been uploaded to R2.
"""

from __future__ import annotations

import argparse
import html
import random
import webbrowser
from pathlib import Path
from typing import Any

import numpy as np

from pipeline.common import (
    Paths,
    add_common_args,
    log,
    paths_from_args,
    read_json,
    read_jsonl,
    sanitize,
    setup_logging,
)

PAGE_CSS = """
body { background:#08080a; color:#e8e8ea; font:14px/1.5 system-ui,sans-serif; margin:0; padding:32px; }
h2 { font-size:15px; font-weight:600; margin:40px 0 12px; color:#fff; }
.row { display:flex; gap:12px; align-items:flex-start; overflow-x:auto; padding-bottom:8px; }
.card { width:150px; flex:0 0 auto; }
.card img { width:150px; border-radius:8px; display:block; background:#18181b; }
.card .meta { font-size:11px; color:#a1a1aa; margin-top:6px; }
.card .name { color:#e8e8ea; font-weight:500; }
.query { border:2px solid #4ade80; border-radius:10px; padding:6px; }
.sim { color:#4ade80; font-variant-numeric:tabular-nums; }
.divider { width:1px; background:#27272a; align-self:stretch; margin:0 8px; }
"""


def card_html(row: dict[str, Any], image: Path, similarity: float | None, is_query: bool) -> str:
    classes = "card query" if is_query else "card"
    sim = f'<div class="sim">{similarity:.4f}</div>' if similarity is not None else ""
    return f"""<div class="{classes}">
  <img src="{html.escape(image.as_uri())}" alt="{html.escape(row['name'])}" loading="lazy">
  <div class="meta">
    <div class="name">{html.escape(row['name'])}</div>
    <div>{html.escape(row.get('illustrator') or '—')}</div>
    <div>{html.escape(row.get('set_name') or '')} · {html.escape(row.get('rarity') or '—')}</div>
    {sim}
  </div>
</div>"""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--card", action="append", default=[], help="Query card id (repeatable)")
    parser.add_argument("--random", type=int, default=0, help="Also pick N random query cards")
    parser.add_argument("--neighbors", type=int, default=10, help="Neighbors per query (default: 10)")
    parser.add_argument("--out", type=Path, default=None, help="Output HTML (default: data/neighbors.html)")
    parser.add_argument("--seed", type=int, default=7, help="Seed for --random")
    parser.add_argument("--open", action="store_true", help="Open the page in a browser when done")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    paths: Paths = paths_from_args(args)

    if not paths.embeddings.exists():
        raise SystemExit(f"No embeddings at {paths.embeddings} — run pipeline.embed first.")

    vectors: np.ndarray = np.load(paths.embeddings)
    card_ids: list[str] = read_json(paths.card_ids)
    if len(card_ids) != vectors.shape[0]:
        raise SystemExit(f"{len(card_ids)} ids vs {vectors.shape[0]} vectors — stage 6 output is corrupt.")

    meta = {row["id"]: row for row in read_jsonl(paths.manifest)}
    index_of = {card_id: i for i, card_id in enumerate(card_ids)}

    queries: list[str] = list(args.card)
    if args.random:
        rng = random.Random(args.seed)
        pool = [c for c in card_ids if c not in queries]
        queries.extend(rng.sample(pool, min(args.random, len(pool))))
    if not queries:
        raise SystemExit("Pass --card <id> and/or --random <n>.")

    unknown = [q for q in queries if q not in index_of]
    if unknown:
        raise SystemExit(f"Not in the embedding set: {', '.join(unknown)}")

    def feed_image(card_id: str) -> Path:
        return paths.images_processed / sanitize(card_id) / "feed.webp"

    sections: list[str] = []
    for query in queries:
        # Vectors are unit-normalized in stage 6, so a dot product is cosine similarity.
        similarities = vectors @ vectors[index_of[query]]
        order = np.argsort(-similarities)
        neighbors = [i for i in order if card_ids[i] != query][: args.neighbors]

        log.info("%s (%s)", query, meta[query]["name"])
        for i in neighbors:
            log.info("   %.4f  %-22s %-28s %s", similarities[i], card_ids[i],
                     meta[card_ids[i]]["name"], meta[card_ids[i]].get("illustrator") or "—")

        cards = [card_html(meta[query], feed_image(query), None, True), '<div class="divider"></div>']
        cards += [card_html(meta[card_ids[i]], feed_image(card_ids[i]), float(similarities[i]), False)
                  for i in neighbors]
        title = f"{meta[query]['name']} — {meta[query].get('illustrator') or '—'} ({query})"
        sections.append(f"<h2>{html.escape(title)}</h2>\n<div class=\"row\">{''.join(cards)}</div>")

    out = args.out or (paths.root / "neighbors.html")
    out.write_text(
        f"<!doctype html><meta charset=utf-8><title>SiftTCG — nearest neighbors</title>"
        f"<style>{PAGE_CSS}</style>\n" + "\n".join(sections),
        encoding="utf-8",
    )
    log.info("Wrote %s (%d queries x %d neighbors)", out, len(queries), args.neighbors)
    if args.open:
        webbrowser.open(out.as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
