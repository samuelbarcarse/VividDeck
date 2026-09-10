-- A ceiling on how many swipes one user may accumulate.
--
-- The threat this closes is storage exhaustion, not privacy. Anyone can mint an
-- anonymous session in one request (lib/supabase/client.ts, ensureSession), and
-- the primary key on swipes is (user_id, card_id), so a single scripted user can
-- legitimately write one row per card in the catalog and no further. That upper
-- bound is the problem: measured on this database, a swipe costs 725 bytes once
-- its index entry is counted, so exhausting the catalog costs
--
--     19,508 cards x 725 B = 14.1 MB per user
--
-- against 423 MB of headroom on the 500 MB free tier. Thirty scripted users fill
-- the database and the project is paused. At the 5,000 cap below the same user
-- costs 3.6 MB, which moves the number of accounts required from ~30 to ~117.
--
-- 5,000 is chosen to be unreachable rather than tuned: the heaviest real account
-- on this database has 452 swipes, so the cap sits eleven times beyond observed
-- human behaviour while still cutting the worst case by three quarters. It is
-- deliberately not a number anyone is expected to meet. Raise it freely if a
-- genuine user ever complains — that would be a good problem to have, and the
-- cap is one integer.
--
-- This is a mitigation, not a fix. It bounds the blast radius per account; it
-- does nothing about the rate at which accounts can be created. CAPTCHA on
-- anonymous sign-in is what actually closes that, and it lives in the Supabase
-- dashboard rather than in SQL.
--
-- Why raise rather than return silently. The function already has two silent
-- return paths (a duplicate swipe, a card with no embedding) and the browser
-- fires this request without awaiting it — components/SwipeDeck.tsx uses
-- `void fetch`, so nothing on the client reads the outcome either way. A third
-- silent path would therefore be invisible in exactly the situation where
-- someone is hammering the endpoint. Raising costs the user nothing and puts the
-- event in the logs, and the route maps it to 429 rather than 500 so it reads as
-- "slow down", not "this broke".
--
-- The count is bounded by construction. Counting a user's swipes on every call
-- would be an index scan proportional to their history; the `limit v_max`
-- subquery stops the scan at 5,000 index tuples no matter how many rows exist,
-- so the check costs the same at the cap as it does above it and an account
-- parked at the ceiling cannot make its own requests progressively dearer.
--
-- Everything below the cap check is unchanged from 0004/0005. It is restated in
-- full because `create or replace` has no way to patch a function body.

create or replace function public.record_swipe(p_card_id text, p_direction smallint)
returns void
language plpgsql
set search_path to 'extensions'
as $function$
declare
  v_user uuid := (select auth.uid());
  v_embedding extensions.vector(512);
  v_max constant integer := 5000;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_direction not in (1, -1) then
    raise exception 'direction must be 1 or -1';
  end if;

  -- Checked before the insert, so a rejected swipe writes nothing at all. The
  -- message is matched by web/app/api/swipe/route.ts to pick the status code;
  -- keep the phrase 'swipe limit' in it if you reword this.
  if (select count(*) from (
        select 1 from public.swipes where user_id = v_user limit v_max
      ) capped) >= v_max then
    raise exception 'swipe limit of % reached', v_max;
  end if;

  insert into public.swipes (user_id, card_id, direction)
  values (v_user, p_card_id, p_direction)
  on conflict (user_id, card_id) do nothing;

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
$function$;

comment on function public.record_swipe(text, smallint) is
  'Records one swipe and folds the card embedding into the user taste vector. Refuses past 5,000 swipes per user to bound storage exhaustion from scripted anonymous accounts.';
