#!/usr/bin/env python3
"""Stage 8 — refresh TCGplayer pricing into card_prices. Weekly, independent of 1-7.

SOURCE CHOICE
-------------
This reads TCGdex's own per-card response, not pokemontcg.io. The original plan
assumed pokemontcg.io was the only TCGplayer source and warned about joining on
set code + card number because the two id schemes disagree. That problem is now
avoidable entirely: TCGdex serves `pricing.tcgplayer` directly, and our card ids
are just `{language}-{tcgdex_id}` (see common.namespaced_id), so the mapping is a
prefix strip with no fuzzy matching and therefore no wrong-card price.

WHAT UPSTREAM ACTUALLY PROVIDES
-------------------------------
    pricing.tcgplayer.<variant>.{lowPrice, midPrice, highPrice, marketPrice,
                                 directLowPrice, productId}
Variants are printings ('normal', 'holofoil', 'reverse-holofoil', ...), NOT
conditions. There is no Near Mint / Lightly Played breakdown anywhere in the
payload — that lives only behind TCGplayer's credentialed partner API. Do not
approximate it from lowPrice/marketPrice; see the 0012 migration header.

COST
----
Pricing is absent from the per-set response, so this is one request per card:
~19.5k requests, about 65 minutes at the default 5 req/sec. That is why
--skip-recent exists, and why a partial run is resumable rather than all-or-
nothing.
"""

from __future__ import annotations

import argparse
import io
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from .common import (
    DEFAULT_RATE_LIMIT,
    TCGdexClient,
    add_common_args,
    failure_logger,
    log,
    paths_from_args,
    record_failure,
    require_env,
    setup_logging,
)

PRICE_COLUMNS = (
    "card_id", "variant", "market_price", "low_price", "mid_price",
    "high_price", "direct_low_price", "product_id", "updated",
)

COLUMN_TYPES = {
    "market_price": "numeric",
    "low_price": "numeric",
    "mid_price": "numeric",
    "high_price": "numeric",
    "direct_low_price": "numeric",
    "product_id": "int",
    "updated": "timestamptz",
}


def copy_value(value: Any) -> str:
    r"""Encode one field for COPY ... FROM STDIN in text format.

    Same rules as stage 7: \N for NULL, and escape anything that would otherwise
    shift a column boundary. Variant keys are upstream strings, so they get the
    same treatment as card names even though a tab in one would be bizarre.
    """
    if value is None:
        return r"\N"
    if isinstance(value, datetime):
        return value.isoformat()
    text = str(value)
    return text.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def copy_buffer(rows: Iterable[tuple[Any, ...]]) -> io.StringIO:
    buffer = io.StringIO()
    for row in rows:
        buffer.write("\t".join(copy_value(v) for v in row) + "\n")
    buffer.seek(0)
    return buffer


def parse_timestamp(value: Any) -> datetime | None:
    """TCGdex sends '2026-09-08T03:18:11.946Z'; fromisoformat wants an offset."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def as_number(value: Any) -> float | None:
    """Upstream returns null, a number, or occasionally a string. 0 is dropped.

    A marketPrice of exactly 0 means "no sales data", not "this card is free" —
    storing it would render as $0.00 and read as a real price.
    """
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def extract_rows(card_id: str, payload: dict[str, Any]) -> list[tuple[Any, ...]]:
    """Flatten one card's pricing.tcgplayer into card_prices rows.

    Returns [] when the card has no TCGplayer pricing at all, which is common for
    Japanese-only cards and for very new sets. That is a legitimate outcome, not a
    failure: the card keeps a null price rather than a guessed one.
    """
    tcgplayer = ((payload.get("pricing") or {}).get("tcgplayer") or {})
    updated = parse_timestamp(tcgplayer.get("updated"))

    rows: list[tuple[Any, ...]] = []
    for variant, prices in tcgplayer.items():
        # 'unit' and 'updated' sit alongside the variant objects as scalars.
        if not isinstance(prices, dict):
            continue

        market = as_number(prices.get("marketPrice"))
        low = as_number(prices.get("lowPrice"))
        mid = as_number(prices.get("midPrice"))
        high = as_number(prices.get("highPrice"))
        direct = as_number(prices.get("directLowPrice"))

        # A variant object with every price null carries no information and would
        # only create a row the UI has to skip.
        if market is None and low is None and mid is None and high is None:
            continue

        product_id = prices.get("productId")
        rows.append((
            card_id, variant, market, low, mid, high, direct,
            int(product_id) if isinstance(product_id, (int, float)) else None,
            updated,
        ))
    return rows


def fetch_targets(cursor: Any, skip_recent_hours: float, limit: int | None) -> list[tuple[str, str, str]]:
    """(card_id, language, tcgdex_id) for every card that needs a price refresh.

    Language comes from the joined set rather than from splitting on the first
    hyphen: TCGdex ids contain hyphens themselves ('base1-4'), so the prefix can
    only be stripped safely once you know how long it is.
    """
    where = ""
    params: list[Any] = []
    if skip_recent_hours > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=skip_recent_hours)
        # Cards with no rows at all must still be selected, hence the left join
        # and the "no successful sync" arm.
        where = """
          where not exists (
            select 1 from public.card_prices p
            where p.card_id = c.id and p.synced_at >= %s
          )
        """
        params.append(cutoff)

    sql = f"""
        select c.id, s.language
        from public.cards c
        join public.sets s on s.id = c.set_id
        {where}
        order by c.id
    """
    if limit:
        sql += f" limit {int(limit)}"

    # psycopg rejects a parameter sequence when the query has no placeholders.
    cursor.execute(sql, params or None)
    targets = []
    for card_id, language in cursor.fetchall():
        prefix = f"{language}-"
        # Defensive: a card whose id does not carry its set's language would
        # otherwise be requested under the wrong catalog and 404 silently.
        if not card_id.startswith(prefix):
            log.warning("skipping %s — id does not start with its set language %r", card_id, prefix)
            continue
        targets.append((card_id, language, card_id[len(prefix):]))
    return targets


def flush(cursor: Any, rows: list[tuple[Any, ...]], card_ids: list[str]) -> int:
    """Upsert a batch of price rows and drop variants upstream no longer lists."""
    if not card_ids:
        return 0

    column_list = ", ".join(PRICE_COLUMNS)
    definition = ", ".join(f"{c} {COLUMN_TYPES.get(c, 'text')}" for c in PRICE_COLUMNS)
    cursor.execute(f"create temp table tmp_card_prices ({definition}) on commit drop")

    if rows:
        with cursor.copy(f"copy tmp_card_prices ({column_list}) from stdin") as copy:
            copy.write(copy_buffer(rows).read())

        cursor.execute(f"""
            insert into public.card_prices ({column_list}, synced_at)
            select {column_list}, now() from tmp_card_prices
            on conflict (card_id, variant) do update set
              market_price     = excluded.market_price,
              low_price        = excluded.low_price,
              mid_price        = excluded.mid_price,
              high_price       = excluded.high_price,
              direct_low_price = excluded.direct_low_price,
              product_id       = excluded.product_id,
              updated          = excluded.updated,
              synced_at        = now()
        """)
        written = cursor.rowcount
    else:
        written = 0

    # Variants can disappear upstream — a set gets a corrected printing list, or
    # TCGdex drops a product. Without this, a card that lost its reverse-holofoil
    # would keep serving last month's price for a variant that no longer exists.
    # Scoped to cards we actually fetched this batch, so a partial run never
    # deletes prices for cards it did not look at.
    cursor.execute(
        """
        delete from public.card_prices p
        where p.card_id = any(%s)
          and not exists (
            select 1 from tmp_card_prices t
            where t.card_id = p.card_id and t.variant = p.variant
          )
        """,
        (card_ids,),
    )
    cursor.execute("drop table tmp_card_prices")
    return written


def recompute_denormalized(cursor: Any) -> int:
    """Rewrite cards.price_usd from card_prices.

    The headline number is the cheapest variant's market price: it answers "what
    does it cost to own this art", which is the question a discovery app is
    actually asking. For the common modern card that means the base printing
    rather than the reverse holo, and for a vintage holo there is only one
    variant so the choice is moot.

    Runs over the whole table, not just this batch, so a card whose last variant
    was deleted correctly falls back to null instead of keeping a stale price.
    """
    cursor.execute("""
        update public.cards c
        set price_usd             = best.market_price,
            price_updated         = best.updated,
            tcgplayer_product_id  = best.product_id
        from (
            select distinct on (p.card_id)
                   p.card_id, p.market_price, p.updated, p.product_id
            from public.card_prices p
            where p.market_price is not null
            order by p.card_id, p.market_price asc, p.variant asc
        ) best
        where best.card_id = c.id
          and (c.price_usd is distinct from best.market_price
               or c.price_updated is distinct from best.updated
               or c.tcgplayer_product_id is distinct from best.product_id)
    """)
    updated = cursor.rowcount

    cursor.execute("""
        update public.cards c
        set price_usd = null, price_updated = null, tcgplayer_product_id = null
        where (c.price_usd is not null or c.tcgplayer_product_id is not null)
          and not exists (
            select 1 from public.card_prices p
            where p.card_id = c.id and p.market_price is not null
          )
    """)
    return updated + cursor.rowcount


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(parser)
    parser.add_argument("--rate", type=float, default=DEFAULT_RATE_LIMIT, help="Max requests/sec")
    parser.add_argument("--workers", type=int, default=4,
                        help="Concurrent requests. Throughput is capped by --rate regardless; "
                             "this just keeps the token bucket saturated despite per-request latency.")
    parser.add_argument("--batch-size", type=int, default=500, help="Cards per database flush")
    parser.add_argument("--skip-recent", type=float, default=0.0, metavar="HOURS",
                        help="Skip cards already synced within this many hours (0 = refresh all). "
                             "Use to resume an interrupted run.")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N cards (testing)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and report, write nothing")
    args = parser.parse_args(argv)

    setup_logging(args.verbose)
    paths = paths_from_args(args)
    failures = failure_logger(paths, "sync_prices")
    env = require_env("DATABASE_URL")

    import psycopg

    client = TCGdexClient(rate_per_sec=args.rate)

    with psycopg.connect(env["DATABASE_URL"]) as connection:
        with connection.cursor() as cursor:
            targets = fetch_targets(cursor, args.skip_recent, args.limit)

        if not targets:
            log.info("Nothing to do — every card was synced within the last %.1fh.", args.skip_recent)
            return 0

        log.info("Pricing %d cards at %.1f req/sec (~%.0f min)",
                 len(targets), args.rate, len(targets) / max(args.rate, 0.001) / 60)

        pending_rows: list[tuple[Any, ...]] = []
        pending_ids: list[str] = []
        done = priced = unpriced = failed = 0

        def fetch(target: tuple[str, str, str]) -> tuple[str, list[tuple[Any, ...]] | None, str | None]:
            card_id, language, tcgdex_id = target
            try:
                payload = client.rest(f"{language}/cards/{tcgdex_id}")
            except Exception as exc:  # noqa: BLE001 — one card must not end the run
                return card_id, None, str(exc)
            if payload is None:
                return card_id, None, "404 from TCGdex"
            return card_id, extract_rows(card_id, payload), None

        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = {pool.submit(fetch, t): t for t in targets}
            for future in as_completed(futures):
                card_id, rows, error = future.result()
                done += 1

                if error is not None:
                    failed += 1
                    record_failure(failures, card_id, error)
                else:
                    # Counted as looked-at either way: a card with no TCGplayer
                    # listing is a real answer, and including its id in the batch
                    # is what lets the delete arm clear a price that went away.
                    pending_ids.append(card_id)
                    if rows:
                        pending_rows.extend(rows)
                        priced += 1
                    else:
                        unpriced += 1

                if not args.dry_run and len(pending_ids) >= args.batch_size:
                    with connection.cursor() as cursor:
                        flush(cursor, pending_rows, pending_ids)
                    connection.commit()
                    pending_rows, pending_ids = [], []

                if done % 1000 == 0 or done == len(targets):
                    log.info("  %d/%d — %d priced, %d without listings, %d failed",
                             done, len(targets), priced, unpriced, failed)

        if args.dry_run:
            log.info("Dry run: %d priced, %d without listings, %d failed. Nothing written.",
                     priced, unpriced, failed)
            return 0

        with connection.cursor() as cursor:
            if pending_ids:
                flush(cursor, pending_rows, pending_ids)
            changed = recompute_denormalized(cursor)
        connection.commit()

    log.info("Done. %d cards priced, %d without listings, %d failed, %d headline prices changed.",
             priced, unpriced, failed, changed)
    if failed:
        log.warning("Failures logged to %s — re-run with --skip-recent 24 to retry just those.", failures)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
