# Findings from building it

Things that were measured rather than assumed, kept because each one changed a
decision and would otherwise have to be rediscovered.

## What the TCGdex API actually looks like

Measured against the live API, because the original spec's assumptions did not
all hold.

**Illustrator and rarity are not in the per-set response.** Getting them the
obvious way means one REST call per card — roughly 40k calls, about 2.2 hours.

**The GraphQL root `cards` query with an id-prefix filter returns hydrated
cards** at ~0.7s per set, which collapses English ingest from hours to minutes.
It is English-only — there is no `/v2/ja/graphql` — so Japanese still costs one
REST call per card. The id filter is a substring match, so results have to be
re-filtered client-side.

**Image coverage is much worse than the card counts suggest:**

| Language | With images | Total | |
|---|---|---|---|
| English | 21,829 | 23,548 | 92.7% |
| Japanese | 3,882 | 12,781 | 30.4% |

Every Japanese set from 1996 through 2021 has zero images. The realistic corpus
is ~25,700 cards, not the ~40k the spec assumed. That is why the catalog is
English-only: Japanese would cost an hour of per-card REST calls to add ~3,900
cards, most of them modern.

**Card ids are not globally unique.** `neo1`–`neo4` exist in both catalogs, so
`neo1-1` is ambiguous. Every id is namespaced `{lang}-{tcgdex_id}`
(`en-base1-4`, `ja-PMCG1-001`), with the original kept in `tcgdex_id`.

**There is no 1200px source.** `high` is the largest asset TCGdex serves and it
is exactly 600×825 for every card checked; `max`, `full`, `xhigh` and `2x` all
404, and `original` returns a 295-byte placeholder. The spec's 1200px detail
rendition would have been a byte-identical copy of the feed image, doubling R2
storage for nothing. Both renditions are now native width and differ by quality
instead — feed at q65 (~51KB, sized for the 20-image prefetch queue), detail at
q90.

**The ~40KB feed target isn't reachable at 600px** without visible banding on
foil art. It assumed downscaling from something larger. q65 lands at 51KB.

**Pricing comes from TCGdex directly.** The per-card REST response carries
`pricing.tcgplayer.*.marketPrice` in USD, which avoids pokemontcg.io and its
set-code + number join problem entirely.

## Neighbour quality

*Measured on an 815-card sample, before the full catalog was ingested.*

The clusters are semantically real — Mantyke pulls Wynaut, Mime Jr., Azurill,
Munchlax, Bonsly and Cleffa; Mareep pulls Pikachu, Flaaffy and Lanturn.

One caveat: Base Set queries returned mostly Base Set neighbours, which suggests
CLIP keys on card frame and era as much as on the illustration. That is a further
argument for not shrinking the 20% random bucket.

A live probe against `feed_for_user` put a number on it. Liking 12 Mitsuhiro
Arita cards and reading back one batch:

| Signal | In the similar bucket | Catalog base rate | Lift |
|---|---|---|---|
| Illustrated by Arita | 3/14 (21%) | 4.2% | ~5× |
| From Base Set | 9/14 (64%) | ~13% | ~5× |

Artist and era lift by the same factor, so this batch **cannot** tell them apart
— consistent with the frame/era confound rather than ruling it out. Arita's cards
are concentrated in Base Set, which is exactly what makes the two hypotheses hard
to separate.

**Still open:** re-run against an illustrator whose work spans several eras
before concluding the embeddings capture style rather than print era.

## Price history

`card_prices` has primary key `(card_id, variant)` and is overwritten on each
sync. There is no history, and therefore no price chart is possible without first
changing that schema to append rather than replace. The watchlist links out to
TCGplayer instead.

## Float32 accumulation

`taste.liked_sum` is a running sum, so removing a card from the watchlist
subtracts its embedding rather than recomputing from scratch. Measured drift
after summing 336 vectors incrementally versus recomputing: ~3.8e-7 relative to
the vector's own magnitude, and 3.6e-7 after `l2_normalize`. The top-200 nearest
neighbours were bit-identical either way. The subtraction adds nothing
measurable.

Related gotcha: `extensions.l2_norm` is ambiguous under pgvector 0.8 because it
is overloaded for `vector`, `halfvec` and `sparsevec`, and casting the argument
does not resolve it. Use `l2_distance(v, zero_vector)` for magnitude instead.
