create extension if not exists vector with schema extensions;

create table sets (
  id            text primary key,
  name          text not null,
  series        text,
  language      text not null,
  release_date  date,
  card_count    int
);

create table cards (
  id            text primary key,
  set_id        text references sets(id),
  name          text not null,
  number        text,
  rarity        text,
  illustrator   text,
  image_key     text not null,
  price_usd     numeric,
  price_updated timestamptz,
  embedding     extensions.vector(512),
  created_at    timestamptz default now()
);

create index cards_illustrator_idx on cards (illustrator);
create index cards_set_id_idx on cards (set_id);

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  created_at    timestamptz default now()
);

create table swipes (
  user_id       uuid references profiles(id) on delete cascade,
  card_id       text references cards(id) on delete cascade,
  direction     smallint not null check (direction in (1, -1)),
  created_at    timestamptz default now(),
  primary key (user_id, card_id)
);

create index swipes_user_created_idx on swipes (user_id, created_at desc);

-- Running sums keep taste updates O(1) instead of O(swipes).
create table taste (
  user_id        uuid primary key references profiles(id) on delete cascade,
  liked_sum      extensions.vector(512),
  liked_count    int default 0,
  disliked_sum   extensions.vector(512),
  disliked_count int default 0,
  updated_at     timestamptz default now()
);

alter table sets     enable row level security;
alter table cards    enable row level security;
alter table profiles enable row level security;
alter table swipes   enable row level security;
alter table taste    enable row level security;

create policy "sets are world readable"
  on sets for select to anon, authenticated using (true);

create policy "cards are world readable"
  on cards for select to anon, authenticated using (true);

create policy "own profile readable"
  on profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile insertable"
  on profiles for insert to authenticated with check ((select auth.uid()) = id);

create policy "own swipes readable"
  on swipes for select to authenticated using ((select auth.uid()) = user_id);
create policy "own swipes insertable"
  on swipes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own swipes updatable"
  on swipes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own swipes deletable"
  on swipes for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own taste readable"
  on taste for select to authenticated using ((select auth.uid()) = user_id);
create policy "own taste insertable"
  on taste for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own taste updatable"
  on taste for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
