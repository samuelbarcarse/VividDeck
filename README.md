# SiftTCG

Swipe-based Pokémon card **art** discovery. Live at **[sifttcg.com](https://sifttcg.com)**.

Swipe right to keep, left to skip, and the feed learns what you actually like looking at.

## Why

There are thousands and thousands of cards in Pokemon TCG. As a collector who appreciates the art, I often have trouble finding new cards amongst the large catalog Pokemon has to offer. Some cards don't get exposure, which makes it difficult to know they exist. 

Many of my reccomendations come from social media, like TikTok. I'll see these and oftentime forget about it the next day.

I wanted to build a platform solely for card art discovery and saving the cards that I would like to add to my collection.

## How the feed works

Every card image is embedded with CLIP into a 512-dimension unit vector. Your
taste is the normalised mean of the cards you liked, minus a fraction of the ones
you skipped:

```
taste = normalize( mean(liked) − 0.3 × mean(disliked) )
```

Both sides are kept as running sums, so recording a swipe is O(1) rather than a
re-scan of your history. Each batch is then mixed from three buckets:

| Bucket | Share | What it is |
|---|---|---|
| similar | 70% | nearest neighbours to your taste vector |
| recent | 10% | newer sets, so the feed is not all 1999 |
| random | 20% | unfiltered exploration |

The random 20% is the product, not a tuning knob. Pure nearest-neighbour serving
collapses into a loop of near-identical cards within a few dozen swipes, and the
only thing that reliably breaks it is showing you something you would not have
been shown. Below 10 swipes there is no taste vector at all and the feed is
random by definition — a cold start you can see rather than one that pretends.

There is also a small penalty on cards above the 90th price percentile, so the
feed does not quietly become a list of chase cards.

The weights live in exactly one place, `db/migrations/0005_taste_feed.sql`, and
are commented where they are declared. They are judgment calls, not derivations.

## Features

**Swipe deck** — one card at a time, drag or arrow keys, with a 20-card prefetch
queue so the next image is already decoded. Opens on Illustration Rares, the
tier that exists because of the art.

**Filters** — by rarity group and by price, the latter on a logarithmic slider
because the interesting range is $0–$50 and the tail runs to $4,500.

**Watchlist** — everything you kept, split into *In progress* and *Completed* so
a want-list and a done-list live in one view. Sort by price, name, artist or
date; search across all of them; select many and act on them at once. Full-card
view with a blurred backdrop, and a link out to TCGplayer for anything you
actually want to buy.

**Artist view** — every card by one illustrator. 386 of them in the catalog.

**Accounts are optional** — you get an anonymous session on first load and can
swipe immediately, no signup wall. Sign in with Google later and the same user id
is kept, so your swipes and your accumulated taste carry across rather than being
abandoned. Anonymous sessions are deleted after a week of inactivity.

## Catalog

| | |
|---|---|
| Cards | 19,508 |
| With embeddings | 19,502 |
| Sets | 149 |
| Illustrators | 386 |
| Price rows | 31,413 |

English only displayed in app. Japanese integration in the future.

## Tech stack

**Web**

| | |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack) |
| UI | React 19.2, Tailwind CSS v4, Framer Motion 13 |
| Auth & data | Supabase (`@supabase/ssr`, `supabase-js`) |
| Hosting | Vercel |

**Data**

| | |
|---|---|
| Database | Postgres 17 on Supabase |
| Vector search | pgvector 0.8, 512-dim, cosine |
| Scheduled jobs | pg_cron |
| Image storage | Cloudflare R2 behind a custom domain |
| CAPTCHA | Cloudflare Turnstile |

**Ingest**

| | |
|---|---|
| Language | Python 3.11+ |
| Embeddings | OpenCLIP `ViT-B-32` / `laion2b_s34b_b79k` |
| Imaging | Pillow — WebP at q65 (feed) and q90 (detail) |
| Storage & DB | boto3, psycopg 3 |
| Source | [TCGdex](https://tcgdex.dev) for catalog, art and TCGplayer pricing |

---

Card images and Pokémon are property of their respective owners. This is a
non-commercial project for browsing card art.
