# Riffle

Swipe-based Pokémon card art discovery. Full product spec in [SPEC.md](SPEC.md).

```
db/         SQL migrations (mirror of what is applied to Supabase)
ingest/     Python pipeline: catalog -> manifest -> images -> R2 -> embeddings -> DB
web/        Next.js 16 app (App Router, Tailwind v4, Framer Motion)
```

## Status

Build order per SPEC.md:

| Step | What | State |
|---|---|---|
| 1 | `fetch_catalog.py` | done, verified on 5 EN sets + 1 JA set |
| 2 | `build_manifest.py` | done, verified (815 cards, 132 illustrators) |
| 3 | `download_images.py` | stub |
| 4 | `process_images.py` | stub |
| 5 | `upload_r2.py` | stub |
| 6 | `embed.py`, `load_db.py` | stub (SQL for feed/swipe already applied) |
| 7 | Swipe UI | scaffolded, serves random feed |
| 8 | `sync_prices.py` | stub — see note below |
| 9–12 | Liked page, artist pages, taste-weighted feed, polish | scaffolded only |

The schema, RLS, feed/swipe RPCs, and the whole web app skeleton are in place — the
gap is stages 3–6, which is what actually puts cards in the database.

## Before anything works

**Anonymous sign-ins must be enabled** in the Supabase dashboard under
Authentication → Sign In / Providers. They are currently off, and `signInAnonymously()`
returns `anonymous_provider_disabled`. Every visitor gets an anonymous session on first
load, so the app is non-functional until this is toggled.

You also need R2 details filled into `web/.env.local` and `ingest/.env` — the example
files carry placeholders for the bucket name, account id, and public custom domain.

## Supabase

Project `dqbtclsbdcglgurchxrb`. Migrations in `db/migrations/` are already applied;
they exist so the schema is reviewable and reproducible, not as a migration runner.

Regenerate types after any schema change:

```bash
npx supabase gen types typescript --project-id dqbtclsbdcglgurchxrb > web/lib/database.types.ts
```

## Ingest

```bash
cd ingest
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env

python -m pipeline.fetch_catalog --languages en --limit-sets 5
python -m pipeline.build_manifest
```

Every stage writes atomically and skips completed work, so re-running is a no-op.
`run_all.py` chains stages 1–7 with `--from`/`--to`.

## Web

```bash
cd web
npm install
cp .env.local.example .env.local
npm run dev
```

## What the API actually looks like

Measured against the live TCGdex API, because the spec's assumptions do not all hold:

- **Illustrator and rarity are not in the per-set response.** Getting them naively means
  one REST call per card — roughly 40k calls, ~2.2 hours.
- **The GraphQL root `cards` query with an id-prefix filter returns hydrated cards** at
  ~0.7s per set, which collapses English ingest from hours to minutes. It is English-only
  (there is no `/v2/ja/graphql`), so Japanese still costs one REST call per card. Note
  the id filter is a substring match, so results must be re-filtered client-side.
- **Image coverage is much worse than the card counts suggest:**

  | Language | With images | Total | |
  |---|---|---|---|
  | English | 21,829 | 23,548 | 92.7% |
  | Japanese | 3,882 | 12,781 | 30.4% |

  Every Japanese set from 1996 through 2021 has zero images. The realistic corpus is
  ~25,700 cards, not ~40k — worth weighing before spending an hour on Japanese ingest.
- **Card ids are not globally unique.** `neo1`–`neo4` exist in both catalogs, so `neo1-1`
  is ambiguous. Every id is namespaced as `{lang}-{tcgdex_id}` (`en-base1-4`,
  `ja-PMCG1-001`) with the original kept in `tcgdex_id`.
- **Stage 8 may be unnecessary.** TCGdex's per-card REST response now carries
  `pricing.tcgplayer.*.marketPrice` in USD, which avoids pokemontcg.io and its
  set-code + number join problem entirely.

## Conventions

- Card images are served straight from R2 as plain `<img>` tags. **Never `next/image`** —
  it would proxy every request through the Next server and defeat the CDN.
- Vector math stays server-side. The client never sees an embedding.
- Recommendation math is commented where it lives (`web/lib/taste.ts`), since the
  weights are judgment calls, not derivations.
