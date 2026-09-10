-- 0014 — price range filtering in the feed
--
-- Adds p_min_price / p_max_price to feed_for_user. The bounds are optional and
-- independent: either, both, or neither may be supplied.
--
-- WHAT A NULL BOUND MEANS
--
-- Null is "no bound", not "zero" and not "infinity". A client that has only
-- dragged the lower handle sends a minimum and leaves the maximum null, and the
-- feed must keep returning the $4,500 Charizard. This matters more than it
-- looks: the UI's slider tops out at $5,000, so if the top handle were sent as a
-- literal 5000 rather than as null, every card above that ceiling would become
-- permanently unreachable the moment the catalog outgrew it. Null at the top of
-- the track means "and above", forever.
--
-- WHAT HAPPENS TO CARDS WITH NO PRICE
--
-- 1,329 of 19,508 cards have no TCGplayer market price at all — promos, very new
-- sets, and a handful of vintage cards with active listings but no completed
-- sales. See 0012 for why that is a fact about upstream rather than a gap we can
-- fill.
--
-- With both bounds null they are included, because no question about price has
-- been asked. As soon as either bound is set they are excluded, because a card
-- with no price cannot be said to fall inside a range. Writing the predicate as
-- two independent `p_x is null or (price is not null and ...)` clauses gets this
-- for free: with both bounds null neither clause constrains anything, and with
-- either bound set the `is not null` test applies.
--
-- Do not "helpfully" coalesce a missing price to 0 to keep those cards in range.
-- A promo with no listings is not a free card, and sorting or filtering it as
-- though it were is the same error 0012 refused to make.
--
-- The predicate is applied in both places the rarity filter is applied: the
-- cold-start branch and the `unswiped` CTE that every bucket draws from. Adding
-- it to only one would let the random or recent bucket leak cards from outside
-- the range, which is the bug 0009 fixed for rarity.
--
-- DROP before CREATE: adding parameters produces a second overload rather than
-- replacing the first, and a two-argument call would then be ambiguous.

drop function if exists public.feed_for_user(int, text[]);

create function public.feed_for_user(
  p_limit     int     default 20,
  p_rarities  text[]  default null,
  p_min_price numeric default null,
  p_max_price numeric default null
)
returns table (
  id text,
  name text,
  image_key text,
  illustrator text,
  rarity text,
  set_name text,
  price_usd numeric,
  bucket text,
  tcgplayer_product_id int
)
language plpgsql
stable
set search_path to 'extensions'
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

  -- Same reasoning as the rarity check above: an inverted or negative range
  -- matches nothing, and an empty batch is indistinguishable from a finished
  -- feed. Both are client bugs, so say so rather than rendering a dead end.
  if p_min_price is not null and p_min_price < 0 then
    raise exception 'minimum price must not be negative: %', p_min_price;
  end if;
  if p_max_price is not null and p_max_price < 0 then
    raise exception 'maximum price must not be negative: %', p_max_price;
  end if;
  if p_min_price is not null and p_max_price is not null and p_min_price > p_max_price then
    raise exception 'price range is inverted: % > %', p_min_price, p_max_price;
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
  -- their commons taught us about their palette. The same goes for the price
  -- range added in 0014 — filtering to cheap cards must not retrain the model.
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
      select c.id, c.name, c.image_key, c.illustrator, c.rarity, s.name, c.price_usd,
             'random'::text, c.tcgplayer_product_id
      from public.cards c
      join public.sets s on s.id = c.set_id
      where c.embedding is not null
        and (not v_filtered or c.rarity_group = any(p_rarities))
        and (p_min_price is null or (c.price_usd is not null and c.price_usd >= p_min_price))
        and (p_max_price is null or (c.price_usd is not null and c.price_usd <= p_max_price))
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
    -- One place to apply the filters. Every bucket below draws from this CTE, so
    -- the random and recent buckets cannot leak a rarity the user unticked or a
    -- card outside the price range.
    select c.id, c.name, c.image_key, c.illustrator, c.rarity,
           s.name as set_name, c.price_usd, c.tcgplayer_product_id,
           c.embedding, s.release_date
    from public.cards c
    join public.sets s on s.id = c.set_id
    where c.embedding is not null
      and (not v_filtered or c.rarity_group = any(p_rarities))
      and (p_min_price is null or (c.price_usd is not null and c.price_usd >= p_min_price))
      and (p_max_price is null or (c.price_usd is not null and c.price_usd <= p_max_price))
      and not exists (
        select 1 from public.swipes w where w.user_id = v_user and w.card_id = c.id
      )
  ),
  nearest as (
    -- Art similarity alone. The price penalty that used to sit in this order by
    -- was removed in 0012 — see that migration before adding anything here. The
    -- price *filter* added in 0014 lives in `unswiped` above, and deliberately
    -- does not touch this ordering: it narrows which cards are eligible, it does
    -- not make expensive art rank higher or lower among them.
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
  select f.id, f.name, f.image_key, f.illustrator, f.rarity, f.set_name,
         f.price_usd, f.bucket, f.tcgplayer_product_id
  from (select * from chosen union all select * from filler) f;
end;
$$;

-- Supports the range scan the new predicate performs. `price_usd` alone rather
-- than a composite: the rarity filter is an equality on a low-cardinality column
-- that the planner is happy to resolve afterwards, and the two filters are used
-- independently as often as together.
create index if not exists cards_price_usd_idx
  on public.cards (price_usd)
  where price_usd is not null;
