-- Build order step 9 owed the liked view pagination. Until now it fetched a
-- flat first 60 and stopped, so a user with 181 likes could reach 60 of them
-- and was told nothing about the rest.
--
-- Keyset, not offset. Two reasons, both real here rather than theoretical:
--   1. The list is ordered by created_at desc, and new likes land at the top.
--      With `offset 60` a like recorded between page 1 and page 2 shifts every
--      row one position down, so the last card of page 1 is served again as the
--      first card of page 2. React then has two children with the same key.
--   2. Offset makes Postgres walk and discard the skipped rows, so page N costs
--      O(N * page). Keyset seeks straight into the index every time.
--
-- The cursor is (created_at, card_id), not created_at alone. created_at has
-- microsecond resolution so collisions are unlikely, but "unlikely" is not
-- "impossible": a tie at the page boundary under a bare `created_at <` would
-- silently drop every tied row, and under `<=` would repeat one forever. The
-- primary key breaks the tie and makes the ordering total.

-- Makes the comparison below total. A null created_at would sort NULLS FIRST
-- under `order by created_at desc` and then never satisfy the cursor predicate,
-- stranding the row. The column has defaulted to now() since 0001 and no code
-- path writes it explicitly, so this only forbids a state that never occurs.
alter table public.swipes alter column created_at set not null;

-- swipes_user_created_idx (0001) is (user_id, created_at desc), which cannot
-- serve the card_id tiebreak and still has to filter direction. This one matches
-- the query exactly and is partial, so it indexes only likes rather than all
-- swipes -- on the current data that is 181 rows instead of 524.
create index swipes_user_liked_idx
  on public.swipes (user_id, created_at desc, card_id desc)
  where direction = 1;

create or replace function public.list_likes(
  p_limit     int         default 60,
  p_before    timestamptz default null,
  p_before_id text        default null
)
returns table (
  card_id     text,
  liked_at    timestamptz,
  name        text,
  image_key   text,
  illustrator text,
  rarity      text,
  price_usd   numeric,
  set_name    text
)
language sql
stable
-- security invoker, so the caller's RLS applies and this cannot become a way to
-- read another user's likes. The explicit user_id predicate below is not a
-- substitute for that policy -- it is what lets the planner use the index.
security invoker
set search_path = ''
as $$
  select c.id, s.created_at, c.name, c.image_key, c.illustrator, c.rarity, c.price_usd, st.name
  from public.swipes s
  join public.cards c on c.id = s.card_id
  -- left join: a card whose set row is missing should still appear in your
  -- likes with a blank set, not vanish from the list.
  left join public.sets st on st.id = c.set_id
  where s.user_id = (select auth.uid())
    and s.direction = 1
    and (
      p_before is null
      or (s.created_at, s.card_id) < (p_before, p_before_id)
    )
  order by s.created_at desc, s.card_id desc
  -- Clamped rather than trusted: p_limit arrives from a query string, and an
  -- unbounded value would let anyone ask for all of their swipes in one row set.
  limit least(greatest(p_limit, 1), 200);
$$;

comment on function public.list_likes(int, timestamptz, text) is
  'One page of the caller''s liked cards, newest first. Pass the last row''s (liked_at, card_id) as (p_before, p_before_id) for the next page.';
