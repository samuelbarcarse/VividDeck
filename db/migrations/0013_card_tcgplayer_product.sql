-- Surface the TCGplayer product id alongside the price.
--
-- The price we show is a single market number with no condition breakdown,
-- because that is all TCGdex exposes (see 0012). A user who wants to know what
-- a Lightly Played copy costs has to go to TCGplayer, so the price line needs to
-- be a link, and a link needs the product id at render time.
--
-- Denormalized onto cards for the same reason price_usd is: the feed, the liked
-- list and the artist page all render a card without joining card_prices, and
-- making each of them aggregate a second table to draw one link would be a lot
-- of query for one anchor tag. card_prices remains the source of truth; stage 8
-- rewrites this column from it.
--
-- Note the id identifies a *product page*, not a variant listing — Furret's
-- `normal` and `reverse-holofoil` both report 219333 — so one per card loses
-- nothing.

alter table public.cards add column if not exists tcgplayer_product_id int;

comment on column public.cards.tcgplayer_product_id is
  'Denormalized from card_prices (cheapest variant). Written by stage 8. '
  'Links to https://www.tcgplayer.com/product/<id>.';

-- Both functions below are dropped rather than replaced: `create or replace`
-- cannot change a function''s return type, and adding a column to `returns
-- table` is exactly that. Same reasoning as the drop in 0009, different cause.

drop function if exists public.list_likes(int, timestamptz, text);

create function public.list_likes(
  p_limit     int         default 60,
  p_before    timestamptz default null,
  p_before_id text        default null
)
returns table (
  card_id text, liked_at timestamptz, name text, image_key text,
  illustrator text, rarity text, price_usd numeric, set_name text,
  tcgplayer_product_id int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, s.created_at, c.name, c.image_key, c.illustrator, c.rarity,
         c.price_usd, st.name, c.tcgplayer_product_id
  from public.swipes s
  join public.cards c on c.id = s.card_id
  left join public.sets st on st.id = c.set_id
  where s.user_id = (select auth.uid())
    and s.direction = 1
    and (
      p_before is null
      or (s.created_at, s.card_id) < (p_before, p_before_id)
    )
  order by s.created_at desc, s.card_id desc
  limit least(greatest(p_limit, 1), 200);
$$;


drop function if exists public.feed_for_user(int, text[]);

create function public.feed_for_user(
  p_limit    int default 20,
  p_rarities text[] default null
)
returns table (
  id text, name text, image_key text, illustrator text,
  rarity text, set_name text, price_usd numeric, bucket text,
  tcgplayer_product_id int
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
      select c.id, c.name, c.image_key, c.illustrator, c.rarity, s.name, c.price_usd,
             'random'::text, c.tcgplayer_product_id
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
           s.name as set_name, c.price_usd, c.tcgplayer_product_id,
           c.embedding, s.release_date
    from public.cards c
    join public.sets s on s.id = c.set_id
    where c.embedding is not null
      and (not v_filtered or c.rarity_group = any(p_rarities))
      and not exists (
        select 1 from public.swipes w where w.user_id = v_user and w.card_id = c.id
      )
  ),
  nearest as (
    -- Art similarity alone. The price penalty that used to sit in this order by
    -- was removed in 0012 — see that migration before adding anything here.
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
