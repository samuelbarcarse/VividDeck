-- 0015 — the watchlist: progress status, bulk removal, one-shot listing.
--
-- SPEC CHANGE
--
-- SPEC listed "Collection or purchase tracking — this is discovery, not
-- inventory" as a non-goal, and told the implementer to push back if asked for
-- it "before the core loop is solid". The core loop is now solid — feed, taste,
-- prefetch queue, artist view, anonymous auth, prices, rarity and price filters
-- have all shipped — so that condition is met and the owner has lifted the
-- non-goal deliberately. SPEC.md is amended in the same commit as this file.
--
-- What is being added is narrow on purpose: a two-state progress flag, not
-- user-defined collections. "In progress" and "completed" are the only buckets.
--
-- WHY A COLUMN ON swipes RATHER THAN A NEW TABLE
--
-- The watchlist *is* the set of rows in swipes with direction = 1, and the
-- primary key is already (user_id, card_id), which is exactly the grain a
-- per-user per-card flag needs. A side table would duplicate that key, add a
-- join to every read, and introduce a second place for the pair to exist. The
-- flag is nullable and only ever set on likes; dislikes keep it null forever.
--
-- Null means in progress. Storing only the completed timestamp — rather than a
-- status enum with a default — means the 337 existing likes need no backfill,
-- and "when did this become completed" is recorded for free rather than thrown
-- away. There is no state a like can be in that this cannot represent.

alter table public.swipes add column if not exists completed_at timestamptz;

comment on column public.swipes.completed_at is
  'Watchlist progress. Null = in progress, non-null = completed (and when). '
  'Only meaningful where direction = 1.';

-- No index. The only query that filters on it also filters on user_id, which
-- swipes_user_liked_idx (0011) already serves, and it then returns the whole
-- list — the largest watchlist in the database is 336 rows. An index here would
-- be write cost for a scan Postgres is not doing.


-- ---------------------------------------------------------------------------
-- Reading the list.
--
-- One shot, not paginated, which reverses the keyset design 0011 introduced.
-- The reason is that the view now sorts, filters and sections client-side, and
-- none of those can be done correctly on a page: "cheapest first" over the most
-- recent 60 of 300 likes returns the cheapest of an arbitrary subset, which is
-- a wrong answer rather than a partial one. Either the sort moves into SQL and
-- the cursor has to generalize over four sort keys and their nulls, or the list
-- arrives whole. At this size — a watchlist is bounded by how many cards a
-- human right-swipes — whole is both simpler and fewer round trips.
--
-- The 2000 clamp is the point where that reasoning stops holding. It is roughly
-- 6x the largest real list and the UI says so plainly when a list reaches it,
-- rather than silently showing a truncated sort. If real lists approach it,
-- restore keyset paging from 0011 and move sorting into SQL — do not just raise
-- the number.
-- ---------------------------------------------------------------------------

-- Superseded by list_watchlist below. Dropped rather than left in place so
-- there is one way to read this list; 0011 and 0013 hold the paginated version
-- if it is ever needed again.
drop function if exists public.list_likes(int, timestamptz, text);

create function public.list_watchlist(p_limit int default 2000)
returns table (
  card_id              text,
  liked_at             timestamptz,
  completed_at         timestamptz,
  name                 text,
  image_key            text,
  illustrator          text,
  rarity               text,
  price_usd            numeric,
  set_name             text,
  tcgplayer_product_id int
)
language sql
stable
-- security invoker, so the caller's RLS applies and this cannot become a way to
-- read another user's watchlist. The explicit user_id predicate is not a
-- substitute for that policy — it is what lets the planner use the index.
security invoker
set search_path = ''
as $$
  select c.id, s.created_at, s.completed_at, c.name, c.image_key, c.illustrator,
         c.rarity, c.price_usd, st.name, c.tcgplayer_product_id
  from public.swipes s
  join public.cards c on c.id = s.card_id
  -- left join: a card whose set row is missing should still appear in your
  -- watchlist with a blank set, not vanish from the list.
  left join public.sets st on st.id = c.set_id
  where s.user_id = (select auth.uid())
    and s.direction = 1
  -- Newest first is the default the UI opens on; every other order is applied
  -- in the browser over the full set.
  order by s.created_at desc, s.card_id desc
  limit least(greatest(coalesce(p_limit, 2000), 1), 2000);
$$;

comment on function public.list_watchlist(int) is
  'The caller''s entire watchlist, newest first. Sorting and filtering happen '
  'client-side over the whole set — see the 0015 migration header.';


-- ---------------------------------------------------------------------------
-- Moving cards between the two sections.
-- ---------------------------------------------------------------------------

create function public.set_cards_completed(p_card_ids text[], p_completed boolean)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_changed int := 0;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_card_ids is null or cardinality(p_card_ids) = 0 then
    return 0;
  end if;

  update public.swipes s
     set completed_at = case when p_completed then now() else null end
   where s.user_id = v_user
     and s.card_id = any(p_card_ids)
     and s.direction = 1
     -- Skip rows already in the requested state, so re-clicking "Completed" does
     -- not rewrite the timestamp and quietly relabel when it happened.
     and (s.completed_at is null) = p_completed;

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

comment on function public.set_cards_completed(text[], boolean) is
  'Move likes between in progress and completed. Returns rows actually changed; '
  'a card already in the target state is skipped, not rewritten.';


-- ---------------------------------------------------------------------------
-- Removing cards from the watchlist.
--
-- THIS MUST UNDO THE TASTE CONTRIBUTION, NOT JUST DELETE THE ROW
--
-- taste holds running sums maintained incrementally by record_swipe — that is
-- the whole reason the feed is O(1) per swipe rather than O(swipes). Deleting a
-- swipe row without subtracting its embedding leaves the taste vector pulled
-- toward a card the user just said they did not want, permanently and
-- invisibly. Worse: deleting the row makes the card eligible for the feed
-- again, so re-liking it would add its embedding a second time and double-count
-- it.
--
-- The subtraction mirrors record_swipe exactly, including its skip: that
-- function returns early without touching taste when a card has no embedding
-- (6 cards in the catalog), so those likes never incremented liked_count and
-- must not decrement it here. Counting the removed rows rather than the removed
-- *embeddings* would drift liked_count below the truth by one per such card.
--
-- When the last like goes, liked_sum is set back to null rather than to a
-- near-zero vector. feed_for_user gates on `liked_count > 0 and liked_sum is
-- not null`, so the two have to agree; it also avoids accumulating float
-- residue in a vector whose true value is exactly zero.
-- ---------------------------------------------------------------------------

create function public.unlike_cards(p_card_ids text[])
returns int
language plpgsql
security invoker
set search_path to 'extensions'
as $$
declare
  v_user    uuid := (select auth.uid());
  v_removed int := 0;
  v_scored  int := 0;
  v_sum     extensions.vector(512);
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_card_ids is null or cardinality(p_card_ids) = 0 then
    return 0;
  end if;

  -- The delete and the sum of what it removed have to be one statement: read
  -- the embeddings first and a concurrent request could delete the same rows in
  -- between, subtracting them from taste twice.
  with removed as (
    delete from public.swipes s
     where s.user_id = v_user
       and s.card_id = any(p_card_ids)
       -- direction = 1 only: this is "remove from watchlist", and it must not
       -- become a way to erase a dislike and have the card resurface.
       and s.direction = 1
    returning s.card_id
  ),
  scored as (
    select c.embedding as e
    from removed r
    join public.cards c on c.id = r.card_id
    where c.embedding is not null
  )
  select (select count(*) from removed),
         (select count(*) from scored),
         (select sum(sc.e) from scored sc)
    into v_removed, v_scored, v_sum;

  if v_scored > 0 then
    update public.taste t
       set liked_count = greatest(t.liked_count - v_scored, 0),
           liked_sum   = case when t.liked_count - v_scored <= 0
                              then null
                              else t.liked_sum - v_sum end,
           updated_at  = now()
     where t.user_id = v_user;
  end if;

  return v_removed;
end;
$$;

comment on function public.unlike_cards(text[]) is
  'Remove likes and subtract their embeddings from the taste running sums. '
  'A true undo: the cards become eligible for the feed again.';
