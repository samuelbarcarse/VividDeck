"""Behavioural check of the 0016 swipe cap. Everything runs in one transaction
that is rolled back, so the database is untouched.

Two separate things are being asked:

  1. The cap binds. At 5,000 swipes the next one is refused, the refusal names
     itself so the route can map it to 429 rather than 500, and — the part that
     actually matters — nothing is written. A cap that raises after the insert
     would be decoration.

  2. Nothing else broke. 0016 restates the whole function body because
     `create or replace` cannot patch one, so the taste math, the duplicate
     no-op and the null-embedding skip are all re-verified here rather than
     assumed to have survived the copy.
"""

import io
import sys
from pathlib import Path

import psycopg
from dotenv import dotenv_values

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
url = dotenv_values(ROOT / "ingest" / ".env").get("DATABASE_URL")

CAP = 5000
ok = True


def check(label: str, got, want) -> None:
    global ok
    good = got == want
    ok = ok and good
    print(f"{'PASS' if good else 'FAIL'}  {label}: got {got!r}, want {want!r}")


with psycopg.connect(url, autocommit=False) as conn:
    uid = conn.execute(
        "select user_id from public.taste order by liked_count desc limit 1"
    ).fetchone()[0]

    # record_swipe is security invoker and reads auth.uid(); without this it
    # would raise 'not authenticated' and every check would pass for the wrong
    # reason.
    conn.execute("select set_config('request.jwt.claims', %s, true)", [f'{{"sub":"{uid}"}}'])
    conn.execute("set local role authenticated")

    started = conn.execute(
        "select count(*) from public.swipes where user_id = %s", [uid]
    ).fetchone()[0]
    print(f"user {uid}, {started} swipes to start\n")

    def swipes() -> int:
        return conn.execute(
            "select count(*) from public.swipes where user_id = %s", [uid]
        ).fetchone()[0]

    def liked_count() -> int:
        return conn.execute(
            "select liked_count from public.taste where user_id = %s", [uid]
        ).fetchone()[0]

    def fresh_card(embedded: bool = True) -> str:
        return conn.execute(
            "select c.id from public.cards c"
            " where c.embedding is " + ("not null" if embedded else "null") +
            "   and not exists (select 1 from public.swipes s"
            "                    where s.user_id = %s and s.card_id = c.id)"
            " limit 1",
            [uid],
        ).fetchone()[0]

    def record(card_id: str, direction: int = 1) -> str | None:
        """Returns None on success, or the error message on refusal."""
        try:
            with conn.transaction():
                conn.execute(
                    "select public.record_swipe(%s, %s::smallint)", [card_id, direction]
                )
            return None
        except psycopg.errors.RaiseException as exc:
            return str(exc).splitlines()[0]

    # 2. The untouched behaviour, checked before the cap is anywhere near.
    card = fresh_card()
    before_liked = liked_count()
    check("a normal swipe is recorded", record(card), None)
    check("  it added a row", swipes(), started + 1)
    check("  taste liked_count moved", liked_count(), before_liked + 1)

    check("the same card again is a no-op", record(card), None)
    check("  it added nothing", swipes(), started + 1)
    check("  taste did not double count", liked_count(), before_liked + 1)

    blank = fresh_card(embedded=False)
    check("a card with no embedding still records", record(blank), None)
    check("  it added a row", swipes(), started + 2)
    check("  but is left out of taste", liked_count(), before_liked + 1)

    check("direction must still be 1 or -1", record(card, 0), "direction must be 1 or -1")

    # 1. The cap. Filled by direct insert rather than 5,000 RPC calls: the cap
    # counts rows, and this keeps the check to a couple of seconds.
    conn.execute(
        "insert into public.swipes (user_id, card_id, direction)"
        " select %s, c.id, 1 from public.cards c"
        "  where not exists (select 1 from public.swipes s"
        "                     where s.user_id = %s and s.card_id = c.id)"
        "  limit %s",
        [uid, uid, CAP - swipes()],
    )
    check("filled to the cap", swipes(), CAP)

    at_cap = fresh_card()
    message = record(at_cap)
    check("the swipe at the cap is refused", message, f"swipe limit of {CAP} reached")
    check("  the route can recognise it", "swipe limit" in (message or ""), True)
    check("  and nothing was written", swipes(), CAP)
    check(
        "  not even the row it was refusing",
        conn.execute(
            "select count(*) from public.swipes where user_id = %s and card_id = %s",
            [uid, at_cap],
        ).fetchone()[0],
        0,
    )

    # A ceiling, not a latch: removing one swipe makes room for one more. This is
    # what stops the cap turning a heavy user's account into a dead end.
    conn.execute(
        "delete from public.swipes where user_id = %s and card_id = %s", [uid, card]
    )
    check("one below the cap again", swipes(), CAP - 1)
    check("a swipe fits once more", record(at_cap), None)
    check("  back at the cap", swipes(), CAP)
    check("  and refused again", record(fresh_card()), f"swipe limit of {CAP} reached")

    conn.rollback()
    print("\nrolled back")

print("\nALL PASS" if ok else "\nSOMETHING FAILED")
sys.exit(0 if ok else 1)
