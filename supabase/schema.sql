-- =========================================================
-- CalTal — Supabase schema
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run: everything is "if not exists" / "or replace".
-- =========================================================

-- ---------- Admins ----------
-- Users in this table may create/edit/delete STANDARD foods (owner_id is null).
-- No RLS policies are defined on it, so it's only editable from the dashboard
-- (SQL editor / table editor), never from the app.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;

-- security definer so policies can consult admins without exposing the table.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- Foods ----------
-- owner_id IS NULL  → standard food, visible to every signed-in user and to signed-out guests.
-- owner_id = a user → private food, visible only to that user.
-- Nutrition values are per serving; the serving is described in the name
-- (e.g. "1 large egg", "6oz steak").
create table if not exists public.foods (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users (id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  calories   numeric not null default 0 check (calories >= 0),
  protein    numeric not null default 0 check (protein  >= 0),
  carbs      numeric not null default 0 check (carbs    >= 0),
  fat        numeric not null default 0 check (fat      >= 0),
  created_at timestamptz not null default now()
);

-- Extra per-serving amounts (added after launch, so added with alter).
--   alcohol  = standard drinks per serving
--   fluid_ml = millilitres of fluid per serving (water, coffee, juice...; alcohol stays 0)
alter table public.foods add column if not exists alcohol  numeric not null default 0 check (alcohol  >= 0);
alter table public.foods add column if not exists fluid_ml numeric not null default 0 check (fluid_ml >= 0);
-- creatine_g = grams of creatine per serving (for the daily creatine check)
alter table public.foods add column if not exists creatine_g numeric not null default 0 check (creatine_g >= 0);

-- One name per owner (case-insensitive); standard foods share the "nil" owner.
-- A private food may share a name with a standard food.
create unique index if not exists foods_owner_name_key
  on public.foods (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index if not exists foods_owner_idx on public.foods (owner_id);

alter table public.foods enable row level security;

drop policy if exists "foods: read standard + own" on public.foods;
create policy "foods: read standard + own" on public.foods
  for select to authenticated
  using (owner_id is null or owner_id = auth.uid());

-- Signed-out visitors (guest mode) can read the standard foods only. Private foods stay hidden.
drop policy if exists "foods: read standard (signed out)" on public.foods;
create policy "foods: read standard (signed out)" on public.foods
  for select to anon
  using (owner_id is null);
grant select on public.foods to anon;

drop policy if exists "foods: insert own, or standard if admin" on public.foods;
create policy "foods: insert own, or standard if admin" on public.foods
  for insert to authenticated
  with check (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

drop policy if exists "foods: update own, or standard if admin" on public.foods;
create policy "foods: update own, or standard if admin" on public.foods
  for update to authenticated
  using      (owner_id = auth.uid() or (owner_id is null and public.is_admin()))
  with check (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

drop policy if exists "foods: delete own, or standard if admin" on public.foods;
create policy "foods: delete own, or standard if admin" on public.foods
  for delete to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

-- ---------- Favourites (per user; can point at standard or own foods) ----------
create table if not exists public.favourites (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  food_id    uuid not null references public.foods (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, food_id)
);
alter table public.favourites enable row level security;

drop policy if exists "favourites: own rows" on public.favourites;
create policy "favourites: own rows" on public.favourites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Log entries ----------
-- Macros are stored as TOTALS (per-serving × quantity), same as the old sheet.
-- food_name is a snapshot so entries survive food edits/deletes, and covers
-- one-off entries (food_id null).
create table if not exists public.log_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date       date not null,
  food_id    uuid references public.foods (id) on delete set null,
  food_name  text not null,
  quantity   numeric not null default 1 check (quantity > 0),
  calories   numeric not null default 0,
  protein    numeric not null default 0,
  carbs      numeric not null default 0,
  fat        numeric not null default 0,
  created_at timestamptz not null default now()
);
-- Totals for the extra amounts (per-serving x quantity), like the macros.
-- eaten_at is when the food was actually eaten (created_at is only insert time).
-- It is null for imported history; time-of-day charts skip null rows.
alter table public.log_entries add column if not exists alcohol  numeric not null default 0;
alter table public.log_entries add column if not exists fluid_ml numeric not null default 0;
alter table public.log_entries add column if not exists eaten_at timestamptz;
alter table public.log_entries add column if not exists creatine_g numeric not null default 0;
create index if not exists log_entries_user_date_idx on public.log_entries (user_id, date);
-- No negative amounts on entries (foods already have these checks). NOT VALID: applies to new and
-- edited rows without re-checking history. Re-runnable: skipped if the constraint already exists.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'log_entries_amounts_nonneg') then
    alter table public.log_entries add constraint log_entries_amounts_nonneg
      check (calories >= 0 and protein >= 0 and carbs >= 0 and fat >= 0
             and alcohol >= 0 and fluid_ml >= 0 and creatine_g >= 0) not valid;
  end if;
end $$;

alter table public.log_entries enable row level security;

drop policy if exists "log_entries: own rows" on public.log_entries;
create policy "log_entries: own rows" on public.log_entries
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Goals (per user, one row) ----------
create table if not exists public.goals (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  calories   numeric check (calories > 0),
  protein    numeric check (protein  > 0),
  fluid_ml   numeric check (fluid_ml > 0),
  creatine_g numeric check (creatine_g > 0),
  updated_at timestamptz not null default now()
);
-- Tables that already exist (goals was created before these two columns):
alter table public.goals add column if not exists fluid_ml   numeric check (fluid_ml   > 0);
alter table public.goals add column if not exists creatine_g numeric check (creatine_g > 0);
alter table public.goals enable row level security;

drop policy if exists "goals: own row" on public.goals;
create policy "goals: own row" on public.goals
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Quick-add buttons (per user, up to 6 slots) ----------
-- Each slot points at a food and has a short label. Deleting the food removes the button.
create table if not exists public.quick_adds (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot    smallint not null check (slot between 0 and 5),
  food_id uuid not null references public.foods (id) on delete cascade,
  label   text not null check (length(trim(label)) between 1 and 10),
  primary key (user_id, slot)
);
-- The table was first created allowing 12 characters; the app has always capped labels at 10.
-- Re-runnable: shorten any longer label, then replace the check.
update public.quick_adds set label = trim(left(trim(label), 10)) where length(trim(label)) > 10;
alter table public.quick_adds drop constraint if exists quick_adds_label_check;
alter table public.quick_adds add constraint quick_adds_label_check check (length(trim(label)) between 1 and 10);
alter table public.quick_adds enable row level security;

drop policy if exists "quick_adds: own rows" on public.quick_adds;
create policy "quick_adds: own rows" on public.quick_adds
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Profile (per user, one row) ----------
-- What the Goals helper ("Help me choose") was last given, so it is prefilled next time.
-- Always stored metric; `units` is only how the helper shows height and weight.
create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  birth_year smallint check (birth_year between 1900 and 2100),
  sex        text check (sex in ('male', 'female', 'other')),
  height_cm  numeric check (height_cm between 50 and 275),
  weight_kg  numeric check (weight_kg between 20 and 400),
  units      text not null default 'us' check (units in ('us', 'metric')),
  activity   text check (activity in ('sitting', 'light', 'moderate', 'very')),
  aim        text check (aim in ('lose_slow', 'lose_fast', 'maintain', 'build')),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles: own row" on public.profiles;
create policy "profiles: own row" on public.profiles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Daily metrics (per user, one row per day) ----------
-- Body weight for now, always in kg (the app shows lb or kg from profiles.units).
-- source says where it came from: typed in the app, imported from Apple Health, or a Shortcut.
create table if not exists public.daily_metrics (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date       date not null,
  weight_kg  numeric check (weight_kg between 20 and 400),
  source     text not null default 'manual' check (source in ('manual', 'import', 'shortcut')),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
alter table public.daily_metrics enable row level security;

drop policy if exists "daily_metrics: own rows" on public.daily_metrics;
create policy "daily_metrics: own rows" on public.daily_metrics
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Optional goal weight, kept with the other goals (null = no goal).
alter table public.goals add column if not exists weight_kg numeric check (weight_kg between 20 and 400);

-- ---------- Sync keys and log_weight (Apple Health Shortcut) ----------
-- One personal key per user, stored only as a SHA-256 hash. RLS is on with
-- no policies, so the app can never read it; only log_weight() (security
-- definer) looks keys up. Make or replace a key with supabase/new_sync_key.sql.
create table if not exists public.sync_keys (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  key_hash   text not null unique,
  created_at timestamptz not null default now()
);
alter table public.sync_keys enable row level security;

-- Called by the Shortcut with the publishable key (role anon):
--   POST /rest/v1/rpc/log_weight  {"p_key":"...","p_date":"2026-11-14","p_value":180.4,"p_unit":"lb"}
-- Upserts that day's weight with source 'shortcut' (a later entry replaces it).
create or replace function public.log_weight(p_key text, p_date date, p_value numeric, p_unit text default 'lb')
returns json
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_kg   numeric;
begin
  select user_id into v_user from public.sync_keys
   where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex');
  if v_user is null then
    raise exception 'Unknown sync key' using errcode = '28000';
  end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 3660 then
    raise exception 'Bad date: %', p_date using errcode = '22008';
  end if;
  if p_unit is null or p_unit not in ('kg', 'lb') then
    raise exception 'Unit must be kg or lb' using errcode = '22023';
  end if;
  v_kg := round(case when p_unit = 'lb' then p_value * 0.45359237 else p_value end, 3);
  if v_kg is null or v_kg < 20 or v_kg > 400 then
    raise exception 'Weight out of range: % %', p_value, p_unit using errcode = '22003';
  end if;

  insert into public.daily_metrics (user_id, date, weight_kg, source, updated_at)
  values (v_user, p_date, v_kg, 'shortcut', now())
  on conflict (user_id, date) do update
    set weight_kg = excluded.weight_kg, source = 'shortcut', updated_at = now();

  return json_build_object('ok', true, 'date', p_date, 'weight_kg', v_kg);
end;
$$;

revoke all on function public.log_weight(text, date, numeric, text) from public;
grant execute on function public.log_weight(text, date, numeric, text) to anon, authenticated;

-- ---------- Daily totals (read by the Trends tab) ----------
-- New columns must be added at the END of the select list (create or replace view).
-- security_invoker makes the view respect the caller's RLS on log_entries.
create or replace view public.daily_totals
with (security_invoker = true) as
  select user_id,
         date,
         sum(calories) as calories,
         sum(protein)  as protein,
         sum(carbs)    as carbs,
         sum(fat)      as fat,
         count(*)      as entries,
         sum(alcohol)  as alcohol,
         sum(fluid_ml) as fluid_ml,
         sum(creatine_g) as creatine_g
  from public.log_entries
  group by user_id, date;

grant select on public.daily_totals to authenticated;
