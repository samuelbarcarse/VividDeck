-- Canonical rarity groups, so "show me only illustration rares" is answerable.
--
-- TCGdex ships 26 distinct rarity strings across 30 years of print history, and
-- they are not a clean taxonomy: `Holo Rare` (35 sets, 2000-2023) and `Rare Holo`
-- (7 sets, 2007-2008) are the same physical card, spelled differently for the
-- DP-era sets. Filtering on the raw string would silently hide 108 cards from
-- anyone who picked "Holo Rare". 60 more cards carry the literal string "None"
-- rather than SQL NULL, which no `rarity is not null` check would catch.
--
-- So the filter runs on a derived group, not the raw string. Two rules:
--
--  1. The mapping is a stored generated column, not a view or a join. The feed
--     filters on it inside a CTE that already scans 19k rows; a join per row is
--     the wrong shape, and a stored column can be indexed.
--
--  2. The group list lives in a table with a foreign key from that column. The
--     CASE below and the chip row in the UI would otherwise be two copies of one
--     taxonomy that drift the first time a set introduces a new rarity — with the
--     FK, a new unmapped string fails the write instead of quietly becoming a
--     group the UI cannot render.
--
-- Anything unrecognized falls to 'unknown' rather than NULL, so it stays
-- filterable and countable instead of disappearing from every grouped query.

create table public.rarity_groups (
  key        text primary key,
  label      text not null,
  sort_order int  not null unique
);

alter table public.rarity_groups enable row level security;

create policy "rarity groups are world readable"
  on public.rarity_groups for select
  using (true);

-- Supabase's default privileges hand anon/authenticated full DML on any new
-- public table. RLS already blocks writes (there is only a select policy), but
-- this table is a foreign-key target for every card, so it should not be one
-- permissive policy away from being writable. Read-only at the grant level too.
revoke insert, update, delete, truncate, references, trigger
  on public.rarity_groups from anon, authenticated;

-- Ordered roughly by scarcity, which is the order a chip row should render in.
insert into public.rarity_groups (key, label, sort_order) values
  ('common',                    'Common',                     10),
  ('uncommon',                  'Uncommon',                   20),
  ('rare',                      'Rare',                       30),
  ('holo_rare',                 'Holo Rare',                  40),
  ('double_rare',               'Double Rare',                50),
  ('ultra_rare',                'Ultra Rare',                 60),
  ('illustration_rare',         'Illustration Rare',          70),
  ('special_illustration_rare', 'Special Illustration Rare',  80),
  ('shiny_rare',                'Shiny Rare',                 90),
  ('secret_rare',               'Secret Rare',               100),
  ('promo',                     'Promo',                     110),
  ('unknown',                   'Unknown',                   120);

-- Immutable by construction: a CASE over a text column with literal arms.
alter table public.cards
  add column rarity_group text
  generated always as (
    case
      when rarity in ('Common')                       then 'common'
      when rarity in ('Uncommon')                     then 'uncommon'
      when rarity in ('Rare')                         then 'rare'

      -- The two spellings of the same card. See the header.
      when rarity in ('Holo Rare', 'Rare Holo')       then 'holo_rare'

      when rarity in ('Double rare')                  then 'double_rare'

      -- The "one step past holo" tier, collapsed across eras: V/VMAX/VSTAR,
      -- LV.X, PRIME, LEGEND, Amazing and Radiant are each a handful of cards
      -- from a single block. Kept apart they would be chips nobody clicks.
      when rarity in ('Ultra Rare', 'Holo Rare V', 'Holo Rare VMAX',
                      'Holo Rare VSTAR', 'Rare Holo LV.X', 'Rare PRIME',
                      'LEGEND', 'Amazing Rare', 'Radiant Rare',
                      'ACE SPEC Rare')                then 'ultra_rare'

      -- Deliberately NOT merged into ultra_rare: full-art illustration rares are
      -- the reason this app exists, and the two IR tiers are what users ask for
      -- by name.
      when rarity in ('Illustration rare')            then 'illustration_rare'
      when rarity in ('Special illustration rare')    then 'special_illustration_rare'

      when rarity in ('Shiny rare', 'Shiny Ultra Rare') then 'shiny_rare'

      -- Cards numbered past the set total: secret, gold/rainbow hyper, and the
      -- BW-era black star equivalents.
      when rarity in ('Secret Rare', 'Hyper rare',
                      'Mega Hyper Rare', 'Black White Rare') then 'secret_rare'

      when rarity in ('Promo')                        then 'promo'

      -- Includes the literal string 'None' (60 cards) and true NULLs.
      else 'unknown'
    end
  ) stored;

-- Rejects any future rarity string the CASE does not map. Without this the
-- taxonomy silently grows an unrenderable group.
alter table public.cards
  add constraint cards_rarity_group_fkey
  foreign key (rarity_group) references public.rarity_groups (key);

-- The feed filters on this alongside `embedding is not null`, so index the pair
-- in the order the planner wants: group first (low cardinality, equality) then
-- the null check.
create index cards_rarity_group_idx
  on public.cards (rarity_group)
  where embedding is not null;
