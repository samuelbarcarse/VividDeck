-- Per-variant TCGplayer pricing, plus removal of the price term from the feed.
--
-- WHY A TABLE AND NOT MORE COLUMNS ON cards
--
-- A card does not have "a" price. Furret (swsh3-136) is sold as `normal` at
-- $0.24 and as `reverse-holofoil` at $0.42 — same art, same card number, nearly
-- 2x apart. Charizard (base1-4) has only `holofoil`. Collapsing that into one
-- numeric column forces a lossy choice at ingest time and makes "show me the
-- reverse holo price" unanswerable forever. One row per (card, variant) keeps
-- the source data intact and lets the UI decide what to show.
--
-- WHAT THIS SCHEMA DELIBERATELY DOES NOT HAVE: CONDITION
--
-- There is no Near Mint / Lightly Played / Moderately Played dimension here,
-- and its absence is a fact about the upstream feed, not an omission to be
-- fixed by adding a column later. TCGdex's card response exposes exactly:
--   pricing.tcgplayer.<variant>.{lowPrice, midPrice, highPrice, marketPrice,
--                                directLowPrice, productId}
-- Those are listing statistics across all conditions, not per-condition prices.
-- `lowPrice` is the cheapest active listing whatever shape it is in; it is not
-- "damaged" and `marketPrice` is not "NM". Condition-tiered pricing exists only
-- in TCGplayer's credentialed partner API, which TCGdex does not proxy.
--
-- Do not synthesize condition tiers by discounting marketPrice. These are real
-- dollar amounts a user may act on, and an invented "LP: $0.19" is worse than
-- no number at all. `product_id` is stored so the UI can link out to TCGplayer,
-- where the real per-condition listings live.

create table public.card_prices (
  card_id          text not null references public.cards(id) on delete cascade,

  -- TCGdex's variant key verbatim: 'normal', 'holofoil', 'reverse-holofoil',
  -- 'firstEditionHolofoil', ... Left as free text rather than an enum because
  -- new set mechanics invent new variants and a weekly sync must not start
  -- failing on an unrecognized one.
  variant          text    not null,

  -- Weighted from completed sales, so it is the number that best answers "what
  -- does this actually trade for". Nullable: TCGdex returns the variant object
  -- with nulls inside for cards that have no recent sales.
  market_price     numeric,
  low_price        numeric,
  mid_price        numeric,
  high_price       numeric,
  direct_low_price numeric,

  -- TCGplayer's own product id, for building an outbound link. Note it is NOT
  -- unique per variant — Furret's `normal` and `reverse-holofoil` both report
  -- 219333 — so it identifies the product page, not the listing.
  product_id       int,

  -- From TCGdex's own `pricing.tcgplayer.updated`, not now(). The distinction
  -- matters when the sync runs against a stale upstream: this answers "how old
  -- is this money", which is what a user would want to know.
  updated          timestamptz,
  synced_at        timestamptz not null default now(),

  primary key (card_id, variant)
);

-- The UI reads every variant of one card at a time; the PK's leading column
-- already serves that. This index serves the other direction — stage 8's
-- recompute of cards.price_usd, which scans for the cheapest variant per card.
create index card_prices_market_idx on public.card_prices (card_id, market_price);

alter table public.card_prices enable row level security;

-- Prices are public catalog data, exactly like cards and sets. Anonymous
-- visitors swipe before signing in and must see the same numbers.
create policy "card prices are world readable"
  on public.card_prices for select to anon, authenticated using (true);

comment on table public.card_prices is
  'Per-variant TCGplayer pricing from TCGdex. Source of truth; cards.price_usd '
  'is a denormalized copy of the cheapest variant''s market_price. No condition '
  'dimension exists upstream — see 0012 migration header before adding one.';

-- cards.price_usd survives as a denormalized headline so the existing read
-- paths (feed_for_user, list_likes, the artist page) keep working unchanged and
-- do not each have to join and aggregate. Stage 8 rewrites it from this table
-- after every sync; card_prices is the source of truth if the two disagree.
comment on column public.cards.price_usd is
  'Denormalized: cheapest variant market_price from card_prices. Written by '
  'stage 8 (sync_prices.py). Do not write directly.';


-- ---------------------------------------------------------------------------
-- Remove the price term from feed ranking.
--
-- SPEC lists "Price-influenced ranking — price is displayed, never ranked on"
-- as an explicit non-goal, but the `nearest` CTE has been adding a constant
-- 0.05 to the cosine distance of every top-decile-priced card since 0005. It
-- never fired, because price_usd has been null for all 19,508 rows since the
-- catalog was loaded — so this was a latent behavior change waiting for the
-- first price sync to switch it on. Removing it now means populating prices
-- changes what is displayed and nothing about what is ranked.
--
-- The idea behind the penalty was not unreasonable (expensive correlates with
-- heavily marketed, which correlates with already-seen). If it comes back it
-- should come back deliberately, measured against a feed that does not have it,
-- and with the SPEC non-goal amended in the same commit.
--
-- Signature is unchanged, so `create or replace` is enough here; contrast 0009,
-- which had to drop first because it was adding a parameter.
-- ---------------------------------------------------------------------------

create or replace function public.feed_for_user(
  p_limit    int default 20,
  p_rarities text[] default null
)
returns table (
  id text, name text, image_key text, illustrator text,
  rarity text, set_name text, price_usd numeric, bucket text
)
language plpgsql
stable
security invoker
set search_path = extensions
as $$
declare
  v_user uuid := (select auth.uid());
  v_taste extensions.vector(512);
  v_liked_sum extensions.vector(512);
  v_liked_count int := 0;
  v_disliked_sum extensions.vector(512);
  v_disliked_count int := 0;
  v_swipes int := 0;

  -- Null or empty both mean "no filter". An empty array arrives naturally when
  -- the user unticks the last box, and it must not mean "show nothing".
  v_filtered boolean := p_rarities is not null and cardinality(p_rarities) > 0;
  v_unknown text[];

  -- Below this many swipes there is not enough signal, so the feed stays random.
  c_cold_start constant int := 10;

  -- A dislike pulls the taste vector away less than a like pulls it in: "not
  -- this one" is weaker evidence than "more of this".
  c_dislike_weight constant real := 0.3;

  -- Batch composition. The random bucket is the product, not a tuning knob: a
  -- pure similarity feed converges within ~40 swipes and then shows the same
  -- popular cards forever, which is the exact failure this app exists to fix.
  -- Do not shrink it for engagement reasons.
  c_mix_random constant real := 0.2;
  c_mix_recent constant real := 0.1;

  c_recent_window constant interval := interval '12 months';

  n_random int;
  n_recent int;
  n_similar int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  -- A misspelled group would otherwise match no rows and return an empty batch,
  -- which the client cannot tell apart from "you have swiped everything". Fail
  -- loudly instead of rendering a dead end.
  if v_filtered then
    select array_agg(r) into v_unknown
    from unnest(p_rarities) as r
    where r not in (select g.key from public.rarity_groups g);

    if v_unknown is not null then
      raise exception 'unknown rarity group(s): %', array_to_string(v_unknown, ', ');
    end if;
  end if;

  select count(*) into v_swipes from public.swipes s where s.user_id = v_user;

  select t.liked_sum, coalesce(t.liked_count, 0), t.disliked_sum, coalesce(t.disliked_count, 0)
    into v_liked_sum, v_liked_count, v_disliked_sum, v_disliked_count
  from public.taste t where t.user_id = v_user;

  -- taste = normalize( liked_sum/liked_count - 0.3 * disliked_sum/disliked_count )
  --
  -- Deliberately computed over every swipe, not just the filtered groups: taste
  -- is a fact about the person, not about the view they are currently looking at.
  -- Someone who filters to illustration rares should still benefit from what
  -- their commons taught us about their palette.
  --
  -- Means rather than sums, so a user with 400 dislikes and 20 likes is not
  -- swamped by the dislike term on volume alone. Multiplying through by the
  -- positive constant (liked_count * disliked_count) clears the division without
  -- changing direction, which is all that survives normalization anyway:
  --   normalize( disliked_count*liked_sum - 0.3*liked_count*disliked_sum )
  -- pgvector has no scalar-times-vector operator, so each scalar becomes a
  -- filled vector and the multiply is element-wise.
  if v_liked_count > 0 and v_liked_sum is not null then
    if v_disliked_count > 0 and v_disliked_sum is not null then
      v_taste := extensions.l2_normalize(
        (v_liked_sum * array_fill(v_disliked_count::real, array[512])::extensions.vector(512))
        - (v_disliked_sum * array_fill((c_dislike_weight * v_liked_count)::real, array[512])::extensions.vector(512))
      );
    else
      -- Dislikes alone describe where not to go, not where to go.
      v_taste := extensions.l2_normalize(v_liked_sum);
    end if;
  end if;

  if v_swipes < c_cold_start or v_taste is null then
    return query
      select c.id, c.name, c.image_key, c.illustrator, c.rarity, s.name, c.price_usd, 'random'::text
      from public.cards c
      join public.sets s on s.id = c.set_id
      where c.embedding is not null
        and (not v_filtered or c.rarity_group = any(p_rarities))
        and not exists (
          select 1 from public.swipes w where w.user_id = v_user and w.card_id = c.id
        )
      order by random()
      limit p_limit;
    return;
  end if;

  n_random := round(p_limit * c_mix_random);
  n_recent := round(p_limit * c_mix_recent);
  n_similar := p_limit - n_random - n_recent;

  return query
  with unswiped as (
    -- One place to apply the filter. Every bucket below draws from this CTE, so
    -- the random and recent buckets cannot leak a rarity the user unticked.
    select c.id, c.name, c.image_key, c.illustrator, c.rarity,
           s.name as set_name, c.price_usd, c.embedding, s.release_date
    from public.cards c
    join public.sets s on s.id = c.set_id
    where c.embedding is not null
      and (not v_filtered or c.rarity_group = any(p_rarities))
      and not exists (
        select 1 from public.swipes w where w.user_id = v_user and w.card_id = c.id
      )
  ),
  nearest as (
    -- Art similarity alone. See the header: the price penalty that used to sit
    -- in this order by was removed in 0012.
    select u.*, 'similar'::text as bucket
    from unswiped u
    order by u.embedding <=> v_taste
    limit n_similar
  ),
  recent as (
    select u.*, 'recent'::text as bucket
    from unswiped u
    where u.release_date >= (current_date - c_recent_window)
      and u.id not in (select s2.id from nearest s2)
    order by random()
    limit n_recent
  ),
  chosen as (
    select * from nearest
    union all
    select * from recent
  ),
  filler as (
    -- Also tops up whatever the similar and recent buckets could not fill, so a
    -- catalog with no recent sets still returns a full batch. With a narrow
    -- filter this is what keeps the batch full when `recent` finds nothing.
    select u.*, 'random'::text as bucket
    from unswiped u
    where u.id not in (select ch.id from chosen ch)
    order by random()
    limit greatest(p_limit - (select count(*) from chosen), 0)
  )
  select f.id, f.name, f.image_key, f.illustrator, f.rarity, f.set_name, f.price_usd, f.bucket
  from (select * from chosen union all select * from filler) f;
end;
$$;


-- Every variant of one card, for the price line and the variant toggle.
-- security invoker + the world-readable policy above; nothing user-scoped here.
create or replace function public.card_prices_for(p_card_id text)
returns table (
  variant text, market_price numeric, low_price numeric, high_price numeric,
  product_id int, updated timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.variant, p.market_price, p.low_price, p.high_price, p.product_id, p.updated
  from public.card_prices p
  where p.card_id = p_card_id
  -- Cheapest first, so the default row the UI shows without a toggle matches
  -- the denormalized cards.price_usd.
  order by p.market_price asc nulls last, p.variant asc;
$$;
