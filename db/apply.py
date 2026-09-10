"""
Applies a migration file to DATABASE_URL, verbatim, in one transaction.

Verbatim matters: pasting SQL into a tool by hand is how the file and the live
database drift apart. Everything the database runs comes from the file on disk.

    ingest/.venv/Scripts/python.exe db/apply.py db/migrations/0014_....sql
"""

import sys
from pathlib import Path

import psycopg
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]

url = dotenv_values(ROOT / "ingest" / ".env").get("DATABASE_URL")
if not url:
    raise SystemExit("DATABASE_URL missing from ingest/.env")

path = Path(sys.argv[1])
sql = path.read_text(encoding="utf-8")

with psycopg.connect(url, autocommit=False) as conn:
    conn.execute(sql)
    conn.commit()

print(f"applied {path.name} ({len(sql)} bytes)")
