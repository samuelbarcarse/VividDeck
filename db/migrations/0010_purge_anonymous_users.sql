-- Anonymous sessions are disposable by design: someone who never signs in should
-- not leave a permanent row behind. Closing the browser does not achieve that on
-- its own — it discards the client's session token while every row it pointed at
-- stays in Postgres, unreachable and uncollected. Deleting the rows is the only
-- thing that actually makes an anonymous list "not saved", so that is what this
-- migration does.
--
-- Sizing, measured on this database rather than guessed: one 512-dim vector is
-- 2052 bytes, so `taste` alone costs ~4.1 KB per user, and swipes run a further
-- ~150-390 B each. An abandoned visitor with 50 swipes is ~15-20 KB; ten thousand
-- of them would be ~150-200 MB against a 500 MB free-tier budget.
--
-- Seven days, not hours. The window has to comfortably exceed the longest
-- plausible open tab, because deleting a live user's row mid-session would make
-- record_swipe fail on swipes_user_id_fkey with a foreign-key error rather than
-- anything a user could interpret. Since an anonymous session is already
-- unreachable once its browser is gone, a longer window costs nothing in privacy
-- terms and buys a lot of safety.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function public.purge_stale_anonymous_users(p_idle interval default interval '7 days')
returns integer
language plpgsql
security definer
-- Empty search_path, so every name below is schema-qualified and the function
-- cannot be redirected by a caller's search_path. Mandatory for security
-- definer: this one deletes users.
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_idle < interval '1 hour' then
    raise exception 'refusing to purge with an idle window under an hour (got %)', p_idle;
  end if;

  with stale as (
    select u.id
    from auth.users u
    where u.is_anonymous
      -- greatest() skips nulls in Postgres, so a user who has never swiped falls
      -- back to their auth timestamps rather than vanishing into a null
      -- comparison and being treated as infinitely old.
      and greatest(
            u.created_at,
            u.updated_at,
            u.last_sign_in_at,
            (select max(s.created_at) from public.swipes s where s.user_id = u.id),
            (select t.updated_at    from public.taste  t where t.user_id = u.id)
          ) < now() - p_idle
  ),
  removed as (
    -- profiles, swipes and taste all cascade from auth.users (migration 0001),
    -- so this single delete is the whole cleanup.
    delete from auth.users a using stale where a.id = stale.id returning a.id
  )
  select count(*) into v_deleted from removed;

  return v_deleted;
end;
$$;

-- Supabase grants execute on new public functions to anon and authenticated by
-- default. A security definer function that deletes users must not be reachable
-- from a browser, and PostgREST exposes anything callable.
revoke all on function public.purge_stale_anonymous_users(interval) from public, anon, authenticated;

comment on function public.purge_stale_anonymous_users(interval) is
  'Deletes anonymous auth.users idle longer than p_idle, cascading to profiles, swipes and taste. Returns the number removed.';

-- 04:17 rather than midnight: cron.schedule takes UTC, and the small offset keeps
-- this off the hour when every other scheduled job on the instance fires.
select cron.schedule(
  'purge-stale-anonymous-users',
  '17 4 * * *',
  $$select public.purge_stale_anonymous_users()$$
);

-- pg_cron never prunes its own history, and an unbounded cron.job_run_details is
-- called out in the Supabase upgrade guide as a cause of failed upgrades.
select cron.schedule(
  'prune-cron-history',
  '42 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
