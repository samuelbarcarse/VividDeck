# Riffle — Project Spec

A swipe-based discovery platform for Pokémon card art. Users are shown one card at a time, swipe right on art they like, and the feed adapts. The purpose is discovering cards the user has never seen — including obscure and unpopular ones — not managing a collection.

Built for the full catalog (English + Japanese, ~40k cards) and multiple users from day one.

## Non-goals

Do not build these. Push back if asked for them before the core loop is solid.

- Collection or purchase tracking — this is discovery, not inventory
- Deck building, trading, marketplace, social feeds
- Price-influenced ranking — price is displayed, never ranked on
- Native mobile app — responsive web + PWA only
- Card scanning / OCR

## Design principle

The 20% random exploration bucket in the recommendation logic is not a tuning knob. It is the product. A pure similarity feed converges within ~40 swipes and then shows the same popular cards forever, which is the exact failure this app exists to fix. Do not remove or reduce it for engagement reasons.

---

## Architecture

```
TCGdex API ──> ingest pipeline (Python, local/cron)
                   │
                   ├──> Cloudflare R2 ──> CDN ──> browser (images)
                   └──> Supabase Postgres + pgvector
                                │
                        Next.js API routes ──> browser (feed, likes)
```

## Stack

| Layer | Choice | Notes |
|---|---|---|
| App | Next.js (App Router), TypeScript | Deployed on Vercel |
| Styling | Tailwind | |
| Gestures | Framer Motion | `drag` with velocity threshold |
| DB | Supabase Postgres + `pgvector` | Vectors, users, swipes |
| Auth | Supabase anonymous sessions | Upgradeable to email later |
| Images | Cloudflare R2 + custom domain | Free egress; this is why it's viable |
| Ingest | Python 3.11+ | Separate from the app, run on a schedule |
| Embeddings | CLIP ViT-B/32 via `open_clip` | 512-dim, unit-normalized |

**Never use `next/image` for card art.** It routes through Vercel's metered optimizer and defeats the purpose of R2. Plain `<img>` with a direct R2 URL.

---

## Repo layout

```
/ingest                  Python — not deployed with the app
  pipeline/
    fetch_catalog.py     stage 1
    build_manifest.py    stage 2
    download_images.py   stage 3
    process_images.py    stage 4
    upload_r2.py         stage 5
    embed.py             stage 6
    load_db.py           stage 7
    sync_prices.py       stage 8 (optional, separate cadence)
  run_all.py             orchestrator
  data/                  gitignored working directory
  requirements.txt

/web
  app/
    page.tsx             swipe view
    liked/page.tsx       liked grid
    artist/[name]/page.tsx
    api/feed/route.ts
    api/swipe/route.ts
  components/
  lib/
    supabase.ts
    taste.ts

/db
  migrations/
```

---

## Data model

```sql
create extension if not exists vector;

create table sets (
  id            text primary key,
  name          text not null,
  series        text,
  language      text not null,          -- 'en' | 'ja' | ...
  release_date  date,
  card_count    int
);

create table cards (
  id            text primary key,       -- TCGdex id
  set_id        text references sets(id),
  name          text not null,
  number        text,
  rarity        text,
  illustrator   text,
  image_key     text not null,          -- R2 object key
  price_usd     numeric,                -- nullable, from stage 8
  price_updated timestamptz,
  embedding     vector(512),
  created_at    timestamptz default now()
);

create index on cards (illustrator);
create index on cards (set_id);

create table profiles (
  id            uuid primary key references auth.users(id),
  created_at    timestamptz default now()
);

create table swipes (
  user_id       uuid references profiles(id),
  card_id       text references cards(id),
  direction     smallint not null,      -- 1 like, -1 dislike
  created_at    timestamptz default now(),
  primary key (user_id, card_id)
);

create index on swipes (user_id, created_at desc);

-- Running sums so taste updates are O(1), not O(swipes)
create table taste (
  user_id       uuid primary key references profiles(id),
  liked_sum     vector(512),
  liked_count   int default 0,
  disliked_sum  vector(512),
  disliked_count int default 0,
  updated_at    timestamptz default now()
);
```

Enable RLS on `swipes`, `taste`, and `profiles` — users read and write only their own rows. `cards` and `sets` are world-readable.

### Indexing note

At ~40k cards, exact cosine search is fast enough and returns exact results. Do not add an HNSW index initially. Add one only if measured p95 feed latency exceeds 150ms, since approximate search trades recall for speed you may not need.

---

## Ingestion pipeline

**Governing rule: eight independent scripts, each resumable and idempotent.** Each reads the previous stage's output from disk and skips work already done. A failure at stage 6 must never require re-running stage 3. `run_all.py` chains them but each must work standalone.

Working directory:
```
data/
  raw/sets.json
  raw/cards/{set_id}.json
  images/original/{card_id}.png
  images/processed/{card_id}.webp
  embeddings.npy + card_ids.json
  manifest.jsonl
```

**1. `fetch_catalog.py`** — Fetch set list, then cards per set from TCGdex. Include Japanese sets. Write raw JSON per set, unmodified. Skip sets already on disk. Throttle to ~5 req/sec — there is no published rate limit, which is a reason to be polite, not to hammer it. Log failures to a file rather than crashing.

**2. `build_manifest.py`** — Flatten raw JSON to `manifest.jsonl`. Print counts (cards, sets, distinct illustrators) and 20 random rows for eyeball inspection. Bad data caught here costs minutes; caught after embedding it costs hours.

**3. `download_images.py`** — TCGdex gives an image *base* URL; append quality and extension to request WebP rather than full PNG. Resumable via skip-if-exists. Exponential backoff on failure. Expect a handful of cards with no image — record and continue. This stage runs for hours; make it safe to leave unattended.

**4. `process_images.py`** — Pillow. Two derivatives per card: `feed` at 600px wide and `detail` at 1200px, both WebP quality 80. Target ~40KB for feed images.

**5. `upload_r2.py`** — `rclone sync` (resumable and parallel by default) or boto3, R2 is S3-compatible. Keys: `cards/{id}/feed.webp`, `cards/{id}/detail.webp`. Set `Cache-Control: public, max-age=31536000, immutable` — these never change.

**6. `embed.py`** — CLIP ViT-B/32 over feed images, batches of 256. Unit-normalize so cosine similarity is a dot product. Save `embeddings.npy` plus `card_ids.json` in matching order. **An off-by-one between these two files silently corrupts every recommendation and is nearly impossible to debug later** — assert lengths match and spot-check three known cards before writing.

**7. `load_db.py`** — Join manifest + embeddings, bulk upsert via `COPY` into a temp table then `insert ... on conflict do update`. Never row-by-row through the client.

**8. `sync_prices.py`** — Separate cadence (weekly). pokemontcg.io uses a **different id scheme than TCGdex**, so join on set code + card number, not id. Leave price null on no match rather than guessing.

### Ongoing sync

New sets release every few months. `run_all.py --incremental` re-runs all stages; skip logic means only new cards do real work. Run it manually after a set drops, or as a weekly GitHub Action.

---

## Recommendation service

### Taste vector

```
taste = normalize( liked_sum/liked_count - 0.3 * disliked_sum/disliked_count )
```

Updated incrementally on each swipe by adding the card's embedding to the relevant running sum. Never recompute from the full swipe history.

Cold start: serve pure random until the user has 10 swipes. Seed those 10 with a deliberately diverse spread across eras, rarities, and illustrators — do not let the first ten come from one set.

### Feed endpoint

`GET /api/feed?n=20` returns the next batch. Composition per batch:

- **70%** nearest neighbors to the taste vector
- **20%** uniform random across the catalog
- **10%** cards from sets released in the last 12 months

Always exclude cards the user has already swiped, in SQL:

```sql
select c.id, c.name, c.image_key, c.illustrator, c.price_usd,
       1 - (c.embedding <=> $1) as similarity
from cards c
where not exists (
  select 1 from swipes s where s.user_id = $2 and s.card_id = c.id
)
order by c.embedding <=> $1
limit $3;
```

Implement as a Postgres function so the three buckets resolve in one round trip.

### Obscurity bias

Down-rank cards in the top decile by `price_usd` within the similarity bucket. Expensive correlates with heavily-marketed, which correlates with already-seen. This is a mild penalty, not a filter — chase cards should still appear, just not dominate.

---

## Frontend

### Swipe view (`/`)

- One card image, full bleed, centered, dominating the viewport
- Name, set, illustrator in small text beneath; price subdued
- Touch drag with velocity threshold; left/right arrow keys on desktop
- Card animates off-screen in the swipe direction

**Prefetching is the highest-priority performance requirement.** Maintain a client queue of 20 cards with images already loaded via `new Image()`. Refill when the queue drops below 8. A visible load between cards is the difference between an app someone uses for twenty minutes and one they delete. Optimistically update the UI on swipe and POST in the background — never block the animation on a network round trip.

### Liked view (`/liked`)

- Grid of liked cards, most recent first, infinite scroll
- Detail modal: larger art, full metadata, link out to TCGplayer search
- CSV export
- Filter by illustrator or set

### Artist view (`/artist/[name]`)

Every card by that illustrator. Reachable from any card. This is likely the most-used feature after the feed — an illustrator is the strongest available proxy for "more art like this."

### Style

Dark background so card art carries the screen. Minimal chrome. The card is the interface.

---

## Auth

Supabase anonymous sessions on first load — no signup wall, swiping works immediately. Offer optional email upgrade from the liked view once a user has ~20 likes worth keeping. Anonymous session data must carry over on upgrade.

---

## Build order

Stop for review after each numbered step.

1. DB migrations and schema
2. Ingest stages 1–2 against 5 sets, verify manifest
3. Ingest stages 3–6 on those sets
4. **Checkpoint: a script that prints the 10 nearest neighbors for a given card id, as an HTML contact sheet.** Do not proceed until these are reviewed. If the neighbors don't look like cards the user would want, the entire concept fails and no amount of UI fixes it. This is worth doing on 5 sets before running the full 40k ingest.
5. Full catalog ingest, all stages
6. Feed endpoint with random-only serving
7. Swipe UI with prefetch queue
8. Taste vector and three-bucket serving
9. Liked view
10. Artist view
11. Auth and anonymous sessions
12. Price sync

## Conventions

- TypeScript strict mode; no `any`
- Python type hints throughout
- Every ingest script runnable standalone, idempotent, with `--help`
- Comment the recommendation math; leave the rest to speak for itself
- Server-side vector math only — never ship 40k embeddings to the browser
