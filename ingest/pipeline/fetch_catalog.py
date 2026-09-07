#!/usr/bin/env python3
"""Stage 1 — fetch the TCGdex catalog to disk, one raw JSON file per set.

Resumable: a set whose file already exists is skipped unless --force. Failures
are recorded to data/logs/fetch_catalog_failures.log rather than crashing the run.

English sets are hydrated in a single GraphQL request; every other language
falls back to one REST request per card, which is slow but resumable per set.
"""

from __future__ import annotations

import argparse
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .common import (
    DEFAULT_RATE_LIMIT,
    LANGUAGES,
    Paths,
    TCGdexClient,
    add_common_args,
    failure_logger,
    log,
    paths_from_args,
    read_json,
    record_failure,
    setup_logging,
    write_json,
)

GRAPHQL_PAGE_SIZE = 250

# `set { cards { ... } }` resolves to card stubs only, and `rarity` is
# non-nullable there so it errors the whole row. The root `cards` query with an
# id-prefix filter is the only batch path that returns hydrated cards.
CARDS_BY_SET_PREFIX = """
{
  cards(filters: {id: "%s-"}, pagination: {page: %d, itemsPerPage: %d}) {
    id
    localId
    name
    illustrator
    rarity
    category
    image
  }
}
"""


def fetch_set_index(client: TCGdexClient, paths: Paths, languages: list[str],
                    force: bool) -> dict[str, list[dict[str, Any]]]:
    # Merge rather than replace: running one language at a time must not discard
    # the languages already indexed.
    index: dict[str, list[dict[str, Any]]] = {}
    if paths.sets_json.exists():
        index = read_json(paths.sets_json)

    stale = [lang for lang in languages if force or lang not in index]
    if not stale:
        log.info("Set index already on disk (%s)", ", ".join(f"{k}={len(v)}" for k, v in index.items()))
        return index

    for language in stale:
        sets = client.rest(f"{language}/sets") or []
        index[language] = sets
        log.info("%s: %d sets", language, len(sets))
    write_json(paths.sets_json, index)
    return index


def hydrate_via_graphql(client: TCGdexClient, set_id: str) -> dict[str, dict[str, Any]]:
    """Return {card_id: full card} for an English set, in one or two requests."""
    hydrated: dict[str, dict[str, Any]] = {}
    page = 1
    while True:
        data = client.graphql(CARDS_BY_SET_PREFIX % (set_id, page, GRAPHQL_PAGE_SIZE))
        batch = data.get("cards") or []
        for card in batch:
            # The id filter is a substring match, so a set whose id ends with
            # this one's would bleed in. Keep only true members.
            if card and card["id"].startswith(f"{set_id}-"):
                hydrated[card["id"]] = card
        if len(batch) < GRAPHQL_PAGE_SIZE:
            return hydrated
        page += 1


def hydrate_via_rest(client: TCGdexClient, language: str, card_ids: list[str],
                     workers: int) -> dict[str, dict[str, Any]]:
    """One detail request per card. The shared rate limiter caps total throughput."""
    def fetch(card_id: str) -> tuple[str, dict[str, Any] | None]:
        return card_id, client.rest(f"{language}/cards/{card_id}")

    hydrated: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for card_id, card in pool.map(fetch, card_ids):
            if card:
                hydrated[card_id] = card
    return hydrated


def fetch_set(client: TCGdexClient, paths: Paths, language: str, set_id: str,
              workers: int, failures: Path) -> int:
    detail = client.rest(f"{language}/sets/{set_id}")
    if not detail:
        record_failure(failures, f"{language}/{set_id}", "set detail 404")
        return 0

    stubs = detail.get("cards") or []
    stub_ids = [c["id"] for c in stubs if c.get("id")]

    if language == "en":
        hydrated = hydrate_via_graphql(client, set_id)
        missing = [cid for cid in stub_ids if cid not in hydrated]
        if missing:
            log.debug("%s/%s: %d cards missing from GraphQL, falling back to REST", language, set_id, len(missing))
            hydrated.update(hydrate_via_rest(client, language, missing, workers))
    else:
        hydrated = hydrate_via_rest(client, language, stub_ids, workers)

    cards = []
    for stub in stubs:
        card = hydrated.get(stub.get("id"))
        if card is None:
            record_failure(failures, f"{language}/{stub.get('id')}", "card detail unavailable")
            card = stub
        cards.append(card)

    set_meta = {k: v for k, v in detail.items() if k != "cards"}
    write_json(paths.set_file(language, set_id), {
        "language": language,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "set": set_meta,
        "cards": cards,
    })
    return len(cards)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--languages", default=",".join(LANGUAGES),
                        help=f"Comma-separated TCGdex languages (default: {','.join(LANGUAGES)})")
    parser.add_argument("--sets", default=None,
                        help="Comma-separated set ids to fetch instead of the whole catalog")
    parser.add_argument("--limit", type=int, default=None,
                        help="Fetch at most N sets per language — useful for a smoke run")
    parser.add_argument("--rate", type=float, default=DEFAULT_RATE_LIMIT,
                        help=f"Max requests/sec across all workers (default: {DEFAULT_RATE_LIMIT})")
    parser.add_argument("--workers", type=int, default=8,
                        help="Concurrent requests; total throughput is still capped by --rate")
    parser.add_argument("--force", action="store_true", help="Refetch sets already on disk")
    args = parser.parse_args(argv)

    setup_logging(args.verbose)
    paths = paths_from_args(args)
    failures = failure_logger(paths, "fetch_catalog")
    client = TCGdexClient(rate_per_sec=args.rate)

    languages = [lang.strip() for lang in args.languages.split(",") if lang.strip()]
    wanted = {s.strip() for s in args.sets.split(",")} if args.sets else None

    index = fetch_set_index(client, paths, languages, args.force)

    total_cards = 0
    for language in languages:
        candidates = [s for s in index.get(language, []) if wanted is None or s["id"] in wanted]
        if args.limit:
            candidates = candidates[: args.limit]
        for position, entry in enumerate(candidates, start=1):
            set_id = entry["id"]
            destination = paths.set_file(language, set_id)
            if destination.exists() and not args.force:
                log.debug("skip %s/%s (already on disk)", language, set_id)
                continue
            log.info("[%s %d/%d] %s", language, position, len(candidates), set_id)
            try:
                total_cards += fetch_set(client, paths, language, set_id, args.workers, failures)
            except Exception as exc:  # a bad set must not take down a multi-hour run
                log.error("%s/%s failed: %s", language, set_id, exc)
                record_failure(failures, f"{language}/{set_id}", str(exc))

    log.info("Done. %d cards written this run. Failures (if any): %s", total_cards, failures)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
