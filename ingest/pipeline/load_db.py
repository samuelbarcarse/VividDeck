#!/usr/bin/env python3
"""Stage 7 — load sets, cards and embeddings into Postgres.

Joins manifest.jsonl with embeddings.npy / card_ids.json and bulk loads through
COPY into an unlogged temp table, then a single insert ... on conflict do update.
Row-by-row through the client would take hours over a pooler connection.

Sets load before cards because cards.set_id is a foreign key. Price columns are
left alone on conflict — those belong to stage 8 and must not be clobbered here.
"""

from __future__ import annotations

import argparse
import io
from typing import Any, Iterable

from .common import (
    Paths,
    add_common_args,
    log,
    paths_from_args,
    read_json,
    read_jsonl,
    require_env,
    setup_logging,
)

SET_COLUMNS = ("id", "name", "series", "language", "release_date", "card_count")
CARD_COLUMNS = ("id", "set_id", "name", "number", "rarity", "illustrator", "image_key", "embedding")


def copy_value(value: Any) -> str:
    r"""Encode one field for COPY ... FROM STDIN in text format.

    NULL is the unquoted \N sentinel, and backslash / tab / newline have to be
    escaped or a card name containing one would shift every later column.
    """
    if value is None:
        return r"\N"
    text = str(value)
    return text.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def copy_buffer(rows: Iterable[tuple[Any, ...]]) -> io.StringIO:
    buffer = io.StringIO()
    for row in rows:
        buffer.write("\t".join(copy_value(v) for v in row) + "\n")
    buffer.seek(0)
    return buffer


def vector_literal(vector: Any) -> str:
    """pgvector's text input format: [0.1,0.2,...]"""
    return "[" + ",".join(f"{float(x):.6f}" for x in vector) + "]"


def load_embeddings(paths: Paths) -> dict[str, str]:
    if not paths.embeddings.exists() or not paths.card_ids.exists():
        return {}

    import numpy as np

    vectors = np.load(paths.embeddings)
    card_ids: list[str] = read_json(paths.card_ids)
    if len(card_ids) != vectors.shape[0]:
        raise SystemExit(
            f"{paths.card_ids} has {len(card_ids)} ids but {paths.embeddings} has "
            f"{vectors.shape[0]} vectors — stage 6 output is corrupt, re-run it."
        )
    return {card_id: vector_literal(vectors[i]) for i, card_id in enumerate(card_ids)}


def upsert(cursor: Any, table: str, columns: tuple[str, ...], rows: list[tuple[Any, ...]],
           types: dict[str, str], update_columns: tuple[str, ...], batch_size: int,
           keep_existing_when_null: tuple[str, ...] = ()) -> None:
    column_list = ", ".join(columns)
    temp = f"tmp_{table}"
    definition = ", ".join(f"{c} {types.get(c, 'text')}" for c in columns)
    cursor.execute(f"create temp table {temp} ({definition}) on commit drop")

    for start in range(0, len(rows), batch_size):
        chunk = rows[start : start + batch_size]
        with cursor.copy(f"copy {temp} ({column_list}) from stdin") as copy:
            copy.write(copy_buffer(chunk).read())
        log.info("  copied %d/%d rows into %s", min(start + batch_size, len(rows)), len(rows), temp)

    assignments = ", ".join(
        f"{c} = coalesce(excluded.{c}, public.{table}.{c})" if c in keep_existing_when_null
        else f"{c} = excluded.{c}"
        for c in update_columns
    )
    cursor.execute(
        f"insert into public.{table} ({column_list}) select {column_list} from {temp} "
        f"on conflict (id) do update set {assignments}"
    )
    log.info("  upserted %d rows into %s", cursor.rowcount, table)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--batch-size", type=int, default=5000, help="Rows per COPY batch")
    parser.add_argument("--skip-embeddings", action="store_true",
                        help="Load metadata only — useful before stage 6 has run")
    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    paths = paths_from_args(args)

    sets_file = paths.root / "sets.jsonl"
    if not paths.manifest.exists() or not sets_file.exists():
        raise SystemExit("Missing manifest.jsonl or sets.jsonl — run build_manifest.py first.")

    env = require_env("DATABASE_URL")

    import psycopg

    set_rows = [
        tuple(row.get(c) for c in SET_COLUMNS)
        for row in read_jsonl(sets_file)
    ]

    embeddings = {} if args.skip_embeddings else load_embeddings(paths)
    if not args.skip_embeddings and not embeddings:
        log.warning("No embeddings found — loading metadata only. Re-run after stage 6.")

    card_rows = []
    for row in read_jsonl(paths.manifest):
        card_rows.append((
            row["id"],
            row["set_id"],
            row["name"],
            row.get("number"),
            row.get("rarity"),
            row.get("illustrator"),
            row["image_key"],
            embeddings.get(row["id"]),
        ))

    with_vectors = sum(1 for r in card_rows if r[-1] is not None)
    log.info("Loading %d sets and %d cards (%d with embeddings)",
             len(set_rows), len(card_rows), with_vectors)

    with psycopg.connect(env["DATABASE_URL"]) as connection:
        with connection.cursor() as cursor:
            log.info("sets:")
            upsert(cursor, "sets", SET_COLUMNS, set_rows,
                   types={"release_date": "date", "card_count": "int"},
                   update_columns=("name", "series", "language", "release_date", "card_count"),
                   batch_size=args.batch_size)

            log.info("cards:")
            # price_usd and price_updated are deliberately absent from the update
            # list: stage 8 owns them and re-running this stage must not wipe them.
            upsert(cursor, "cards", CARD_COLUMNS, card_rows,
                   types={"embedding": "extensions.vector(512)"},
                   update_columns=("set_id", "name", "number", "rarity", "illustrator",
                                   "image_key", "embedding"),
                   batch_size=args.batch_size,
                   # A metadata-only run (--skip-embeddings, or before stage 6) must
                   # not null out vectors that are already loaded.
                   keep_existing_when_null=("embedding",))
        connection.commit()

    log.info("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
