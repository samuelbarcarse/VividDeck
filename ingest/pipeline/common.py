"""Shared plumbing for the ingest stages: paths, throttled HTTP, logging."""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Sequence

import requests

INGEST_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = INGEST_ROOT / "data"

TCGDEX_REST = "https://api.tcgdex.net/v2"
TCGDEX_GRAPHQL = "https://api.tcgdex.net/v2/graphql"

# TCGdex publishes no rate limit. That is a reason to be polite, not to hammer it.
DEFAULT_RATE_LIMIT = 5.0

LANGUAGES = ("en", "ja")

log = logging.getLogger("ingest")


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def raw(self) -> Path:
        return self.root / "raw"

    @property
    def sets_json(self) -> Path:
        return self.raw / "sets.json"

    @property
    def raw_cards(self) -> Path:
        return self.raw / "cards"

    def set_file(self, language: str, set_id: str) -> Path:
        # EN and JA share four set ids (neo1-neo4), so the language has to be
        # part of the path or the two catalogs overwrite each other.
        return self.raw_cards / language / f"{sanitize(set_id)}.json"

    @property
    def manifest(self) -> Path:
        return self.root / "manifest.jsonl"

    @property
    def images_original(self) -> Path:
        return self.root / "images" / "original"

    @property
    def images_processed(self) -> Path:
        return self.root / "images" / "processed"

    @property
    def embeddings(self) -> Path:
        return self.root / "embeddings.npy"

    @property
    def card_ids(self) -> Path:
        return self.root / "card_ids.json"

    @property
    def logs(self) -> Path:
        return self.root / "logs"


def sanitize(value: str) -> str:
    """Make a TCGdex id safe to use as a filename on Windows and POSIX."""
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in value)


def namespaced_id(language: str, tcgdex_id: str) -> str:
    """Globally unique id.

    TCGdex ids are only unique within a language: `neo1-1` exists in both the
    English and Japanese catalogs. Since `cards.id` is the primary key across
    the whole combined catalog, the language has to be part of it.
    """
    return f"{language}-{tcgdex_id}"


class RateLimiter:
    """Token bucket shared across worker threads."""

    def __init__(self, rate_per_sec: float) -> None:
        self._min_interval = 1.0 / rate_per_sec if rate_per_sec > 0 else 0.0
        self._lock = threading.Lock()
        self._next_at = 0.0

    def acquire(self) -> None:
        if not self._min_interval:
            return
        with self._lock:
            now = time.monotonic()
            wait = max(0.0, self._next_at - now)
            self._next_at = max(now, self._next_at) + self._min_interval
        if wait:
            time.sleep(wait)


class TCGdexClient:
    """Throttled TCGdex client with exponential backoff.

    The GraphQL endpoint is English-only but returns fully hydrated cards
    (illustrator, rarity) in one request per set. The REST endpoint covers every
    language but its per-set response contains only card stubs, so non-English
    catalogs need one detail request per card.
    """

    def __init__(self, rate_per_sec: float = DEFAULT_RATE_LIMIT, max_retries: int = 5) -> None:
        self.limiter = RateLimiter(rate_per_sec)
        self.max_retries = max_retries
        self.session = requests.Session()
        # The URL tracks wherever the repository actually lives, which is not the
        # same thing as the product name — update it if and when the repo is
        # renamed, not when the app is.
        self.session.headers["User-Agent"] = "sifttcg-ingest/0.1 (+https://github.com/samuelbarcarse/VividDeck)"

    def _request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            self.limiter.acquire()
            try:
                response = self.session.request(method, url, timeout=30, **kwargs)
                if response.status_code == 404:
                    return response
                if response.status_code in (429, 500, 502, 503, 504):
                    raise requests.HTTPError(f"{response.status_code} from {url}", response=response)
                response.raise_for_status()
                return response
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
                backoff = min(60.0, 2**attempt) + random.uniform(0, 0.5)
                log.warning("%s %s failed (attempt %d/%d): %s — retrying in %.1fs",
                            method, url, attempt + 1, self.max_retries, exc, backoff)
                time.sleep(backoff)
        raise RuntimeError(f"{method} {url} failed after {self.max_retries} attempts") from last_error

    def rest(self, path: str) -> Any | None:
        """GET a REST path. Returns None on 404."""
        response = self._request("GET", f"{TCGDEX_REST}/{path.lstrip('/')}")
        if response.status_code == 404:
            return None
        return response.json()

    def graphql(self, query: str) -> dict[str, Any]:
        response = self._request("POST", TCGDEX_GRAPHQL, json={"query": query})
        payload = response.json()
        if payload.get("errors"):
            raise RuntimeError(f"GraphQL errors: {json.dumps(payload['errors'])[:500]}")
        return payload.get("data") or {}


def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield json.loads(line)


def write_jsonl(path: Path, rows: Sequence[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    tmp.replace(path)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def failure_logger(paths: Paths, stage: str) -> Path:
    """Per-stage failure log. Stages record and continue rather than crashing."""
    paths.logs.mkdir(parents=True, exist_ok=True)
    return paths.logs / f"{stage}_failures.log"


def record_failure(path: Path, item: str, reason: str) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{item}\t{reason}\n")


def add_common_args(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR,
                        help="Working directory for intermediate artifacts (default: ingest/data)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Debug logging")
    return parser


def setup_logging(verbose: bool = False) -> None:
    # Card names carry δ, é, ♀ and Japanese illustrator names. A Windows console
    # defaults to cp1252, where printing any of those raises UnicodeEncodeError
    # and takes the whole stage down — after the data was already written.
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")

    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )


def paths_from_args(args: argparse.Namespace) -> Paths:
    paths = Paths(root=Path(args.data_dir))
    paths.root.mkdir(parents=True, exist_ok=True)
    return paths


def load_env() -> None:
    """Load ingest/.env if python-dotenv is available."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(INGEST_ROOT / ".env")


def require_env(*names: str) -> dict[str, str]:
    load_env()
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}\n"
                         f"Copy ingest/.env.example to ingest/.env and fill them in.")
    return {n: os.environ[n] for n in names}
