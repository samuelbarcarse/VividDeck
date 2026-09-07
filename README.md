# VividDeck

Swipe-based Pokémon card art discovery

```
db/         SQL migrations (mirror of what is applied to Supabase)
ingest/     Python pipeline: catalog -> manifest -> images -> R2 -> embeddings -> DB
web/        Next.js 16 app (App Router, Tailwind v4, Framer Motion)
```

## Status

Ingest stages (`ingest/pipeline/`):

| Stage | What | State |
|---|---|---|
| 1 | `fetch_catalog.py` | done, verified on 5 EN sets + 1 JA set |
| 2 | `build_manifest.py` | done, verified (815 cards, 132 illustrators) |
| 3 | `download_images.py` | done, 815/815 downloaded, 0 failures |
| 4 | `process_images.py` | done, 815 cards x 2 renditions |
| 5 | `upload_r2.py` | done, 1630 objects / 113.7 MB, 0 failed |
| 6 | `embed.py` | done, 815x512 embeddings, spot checks pass |
| 7 | `load_db.py` | done, 6 sets + 815 cards, all embeddings unit-norm |
| 8 | `sync_prices.py` | stub — see note below |

Every stage has now run end to end on the 5-set sample. Re-running any of them is
a no-op.

Build order per SPEC.md:

| Step | What | State |
|---|---|---|
| 1 | DB migrations and schema | done, 6 migrations applied |
| 2–3 | Ingest stages 1–7 on 5 sets | done, data live in Supabase and R2 |
| 4 | **Neighbor-quality checkpoint** | `neighbors.py` written, contact sheet generated — **awaiting your review** |
| 5 | Full catalog ingest | not started, gated on step 4 |
| 6–7 | Feed endpoint, swipe UI with prefetch | done |
| 8 | Taste vector + three-bucket serving | done, verified end to end against a synthetic fixture |
| 9–12 | Liked view, artist view, auth, price sync | scaffolded only |

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
python -m pipeline.download_images
python -m pipeline.process_images
python -m pipeline.embed
```

Every stage writes atomically and skips completed work, so re-running is a no-op.
`run_all.py` chains stages 1–7 with `--from`/`--to`.

### Reviewing recommendation quality

Build order step 4 is a hard gate: if the nearest neighbors don't look like cards
you'd want to see next, the concept fails and no UI work fixes it.

```bash
python neighbors.py --card en-base1-4 --random 6 --open
```

Writes `data/neighbors.html`, a contact sheet of each query card beside its ten
nearest neighbors, reading images from local disk so it works before any upload.

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
- **There is no 1200px source.** `high` is the largest asset TCGdex serves, and it
  is exactly 600x825 for every one of the 815 cards checked; `max`, `full`, `xhigh`
  and `2x` all 404, and `original` returns a 295-byte placeholder. The spec's
  1200px detail rendition would have been a byte-identical copy of feed, doubling
  R2 storage for nothing. Both renditions are now native width and differ by
  quality instead — feed at q65 (~51KB, sized for the 20-image prefetch queue),
  detail at q90.
- **The ~40KB feed target isn't reachable at 600px** without visible banding on
  foil art; it assumed downscaling from something larger. q65 lands at 51KB.

### Neighbor quality, first read

On 815 cards the clusters are semantically real — Mantyke pulls Wynaut, Mime Jr.,
Azurill, Munchlax, Bonsly and Cleffa; Mareep pulls Pikachu, Flaaffy and Lanturn.
One caveat to watch once the full catalog is in: Base Set queries return mostly
Base Set neighbors, so CLIP is keying on card frame and era as much as on the art.
That is another argument for not shrinking the 20% random bucket.

A live probe against `feed_for_user` puts a number on that caveat. Liking 12
Mitsuhiro Arita cards and reading back one batch:

| Signal | In the similar bucket | Catalog base rate | Lift |
|---|---|---|---|
| Illustrated by Arita | 3/14 (21%) | 4.2% | ~5x |
| From Base Set | 9/14 (64%) | ~13% | ~5x |

Artist and era lift by the same factor, so this batch cannot tell them apart —
consistent with the frame/era confound rather than ruling it out. Arita's cards
are concentrated in Base Set, which is exactly what makes the two hypotheses hard
to separate. Worth re-running against an illustrator whose work spans several eras
before concluding the embeddings capture style.

## Conventions

- Card images are served straight from R2 as plain `<img>` tags. **Never `next/image`** —
  it would proxy every request through the Next server and defeat the CDN.
- Vector math stays server-side. The client never sees an embedding.
- Recommendation math lives only in `db/migrations/0005_taste_feed.sql`. The weights
  are judgment calls, not derivations, and are commented where they are declared.
  Deliberately not mirrored in TypeScript — two copies of a tuning constant drift.
- pgvector is installed into the `extensions` schema, so any function touching a
  vector needs `set search_path = extensions` (operator resolution goes through
  search_path). Keep every table reference `public.`-qualified.
