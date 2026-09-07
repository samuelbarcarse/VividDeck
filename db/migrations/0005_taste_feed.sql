-- Build order step 8: taste vector and three-bucket serving.
--
-- All of this lives in one function so a batch resolves in a single round trip
-- and no embedding ever leaves Postgres. The weights below are the recommendation
-- math; they are deliberately in exactly one place.

drop function if exists public.feed_random(int);

create function public.feed_for_user(p_limit int default 20)
returns table (
  id text, name text, image_key text, illustrator text,
  rarity text, set_name text, price_usd numeric, bucket text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_taste extensions.vector(512);
  v_liked_sum extensions.vector(512);
  v_liked_count int := 0;
  v_disliked_sum extensions.vector(512);
  v_disliked_count int := 0;
  v_swipes int := 0;
  v_price_cutoff numeric;

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

  -- Mild penalty on cosine distance for top-decile prices. Expensive correlates
  -- with heavily marketed, which correlates with already-seen. Chase cards should
  -- still appear, just not dominate. This is not a filter.
  c_price_penalty constant real := 0.05;

  n_random int;
  n_recent int;
  n_similar int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  select count(*) into v_swipes from public.swipes s where s.user_id = v_user;

  select t.liked_sum, coalesce(t.liked_count, 0), t.disliked_sum, coalesce(t.disliked_count, 0)
    into v_liked_sum, v_liked_count, v_disliked_sum, v_disliked_count
  from public.taste t where t.user_id = v_user;

  -- taste = normalize( liked_sum/liked_count - 0.3 * disliked_sum/disliked_count )
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
      where not exists (
        select 1 from public.swipes w where w.user_id = v_user and w.card_id = c.id
      )
      order by random()
      limit p_limit;
    return;
  end if;

  n_random := round(p_limit * c_mix_random);
  n_recent := round(p_limit * c_mix_recent);
  n_similar := p_limit - n_random - n_recent;

  select percentile_cont(0.9) within group (order by c.price_usd)
    into v_price_cutoff
  from public.cards c where c.price_usd is not null;

  return query
  with unswiped as (
    select c.id, c.name, c.image_key, c.illustrator, c.rarity,
           s.name as set_name, c.price_usd, c.embedding, s.release_date
    from public.cards c
    join public.sets s on s.id = c.set_id
    where not exists (
      select 1 from public.swipes w where w.user_id = v_user and w.card_id = c.id
    )
  ),
  nearest as (
    select u.*, 'similar'::text as bucket
    from unswiped u
    where u.embedding is not null
    order by (u.embedding <=> v_taste)
             + case when v_price_cutoff is not null and u.price_usd >= v_price_cutoff
                    then c_price_penalty else 0 end
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
    -- catalog with no recent sets still returns a full batch.
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
