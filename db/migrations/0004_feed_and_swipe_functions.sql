-- Build order step 6: random-only serving. The three-bucket mix lands in step 8.
create function public.feed_random(p_limit int default 20)
returns table (
  id text, name text, image_key text, illustrator text,
  rarity text, set_name text, price_usd numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.name, c.image_key, c.illustrator, c.rarity, s.name, c.price_usd
  from public.cards c
  join public.sets s on s.id = c.set_id
  where not exists (
    select 1 from public.swipes w
    where w.user_id = (select auth.uid()) and w.card_id = c.id
  )
  order by random()
  limit p_limit;
$$;

-- Records the swipe and folds the card's embedding into the user's running
-- sums in one round trip, so taste stays O(1) and no embedding ever reaches
-- the browser.
create function public.record_swipe(p_card_id text, p_direction smallint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_embedding extensions.vector(512);
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_direction not in (1, -1) then
    raise exception 'direction must be 1 or -1';
  end if;

  insert into public.swipes (user_id, card_id, direction)
  values (v_user, p_card_id, p_direction)
  on conflict (user_id, card_id) do nothing;

  -- Re-swiping a card must not double-count it into the running sums.
  if not found then
    return;
  end if;

  select embedding into v_embedding from public.cards where id = p_card_id;
  if v_embedding is null then
    return;
  end if;

  insert into public.taste (user_id, liked_sum, liked_count, disliked_sum, disliked_count)
  values (
    v_user,
    case when p_direction = 1 then v_embedding end,
    case when p_direction = 1 then 1 else 0 end,
    case when p_direction = -1 then v_embedding end,
    case when p_direction = -1 then 1 else 0 end
  )
  on conflict (user_id) do update set
    liked_sum = case when p_direction = 1
                     then coalesce(taste.liked_sum + v_embedding, v_embedding)
                     else taste.liked_sum end,
    liked_count = taste.liked_count + case when p_direction = 1 then 1 else 0 end,
    disliked_sum = case when p_direction = -1
                        then coalesce(taste.disliked_sum + v_embedding, v_embedding)
                        else taste.disliked_sum end,
    disliked_count = taste.disliked_count + case when p_direction = -1 then 1 else 0 end,
    updated_at = now();
end;
$$;
