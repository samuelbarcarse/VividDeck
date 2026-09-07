-- pgvector is installed into the extensions schema, and operator resolution goes
-- through search_path just like function resolution does. With `search_path = ''`
-- the vector operators (+, -, *, <=>) are invisible, so record_swipe failed on the
-- first real swipe and feed_for_user would have failed on the first non-cold-start
-- batch. Neither surfaced earlier because both paths need actual embeddings.
--
-- search_path is still pinned to a single trusted schema, which is what the
-- hardening is for; every table reference stays explicitly public-qualified.

create or replace function public.record_swipe(p_card_id text, p_direction smallint)
returns void
language plpgsql
security invoker
set search_path = extensions
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

alter function public.feed_for_user(int) set search_path = extensions;
