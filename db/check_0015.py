"""Behavioural check of the 0015 functions. Everything runs in one transaction
that is rolled back, so the database is untouched.

What is being asked:
  1. set_cards_completed reports rows it actually changed, and a second identical
     call reports 0 — re-clicking "Completed" must not rewrite the timestamp and
     quietly relabel when it happened.
  2. It refuses to touch a dislike, so this cannot become a way to resurrect a
     card the user skipped.
  3. list_watchlist surfaces completed_at, and its p_limit is clamped at both
     ends rather than trusted.
  4. unlike_cards ignores direction = -1 for the same reason as (2).
"""

import io
import sys
from pathlib import Path

import psycopg
from dotenv import dotenv_values

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
url = dotenv_values(ROOT / "ingest" / ".env").get("DATABASE_URL")

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

    # Impersonate that user for the rest of the transaction: both functions are
    # security invoker and read auth.uid(), so without this they see no rows and
    # every check below would pass for the wrong reason.
    conn.execute("select set_config('request.jwt.claims', %s, true)", [f'{{"sub":"{uid}"}}'])
    conn.execute("set local role authenticated")

    likes = [
        r[0]
        for r in conn.execute(
            "select card_id from public.swipes where user_id = %s and direction = 1"
            " order by created_at desc limit 4",
            [uid],
        ).fetchall()
    ]
    dislike = conn.execute(
        "select card_id from public.swipes where user_id = %s and direction = -1 limit 1",
        [uid],
    ).fetchone()[0]

    print(f"user {uid}, likes {likes}, dislike {dislike}\n")

    call = lambda sql, *args: conn.execute(sql, args).fetchone()[0]

    # 1. Idempotence.
    check("mark 3 completed", call("select public.set_cards_completed(%s, true)", likes[:3]), 3)
    check("mark the same 3 again", call("select public.set_cards_completed(%s, true)", likes[:3]), 0)
    check("move 2 of them back", call("select public.set_cards_completed(%s, false)", likes[:2]), 2)
    check("move the same 2 again", call("select public.set_cards_completed(%s, false)", likes[:2]), 0)

    # A mixed batch reports only the rows that moved, not the size of the batch.
    check("mixed batch of 3, one already done", call("select public.set_cards_completed(%s, true)", likes[:3]), 2)

    # 2. Dislikes are out of reach.
    check("cannot complete a dislike", call("select public.set_cards_completed(%s, true)", [dislike]), 0)
    check("empty array is a no-op", call("select public.set_cards_completed(%s, true)", []), 0)
    check("null array is a no-op", call("select public.set_cards_completed(null, true)"), 0)

    # 3. Reading it back.
    rows = conn.execute("select card_id, completed_at from public.list_watchlist()").fetchall()
    done = {c for c, at in rows if at is not None}
    check("list_watchlist reports the 3 completed", sorted(done), sorted(likes[:3]))
    check("dislike is absent from the list", dislike in {c for c, _ in rows}, False)

    check("p_limit clamps up from 0", len(conn.execute("select * from public.list_watchlist(0)").fetchall()), 1)
    check(
        "p_limit clamps down to 2000",
        len(conn.execute("select * from public.list_watchlist(999999)").fetchall()),
        min(len(rows), 2000),
    )

    # Newest first is the order the UI opens on and the only one the SQL owes.
    ordered = conn.execute("select liked_at from public.list_watchlist(50)").fetchall()
    check("newest first", [r[0] for r in ordered] == sorted((r[0] for r in ordered), reverse=True), True)

    # 4. unlike_cards will not erase a dislike.
    check("cannot unlike a dislike", call("select public.unlike_cards(%s)", [dislike]), 0)
    check(
        "the dislike row survived",
        conn.execute(
            "select count(*) from public.swipes where user_id = %s and card_id = %s",
            [uid, dislike],
        ).fetchone()[0],
        1,
    )

    conn.rollback()
    print("\nrolled back")

print("\nALL PASS" if ok else "\nSOMETHING FAILED")
sys.exit(0 if ok else 1)
