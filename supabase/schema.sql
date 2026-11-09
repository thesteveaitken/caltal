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
-- owner_id IS NULL  → standard food, visible to every signed-in user.
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
create index if not exists log_entries_user_date_idx on public.log_entries (user_id, date);

alter table public.log_entries enable row level security;

drop policy if exists "log_entries: own rows" on public.log_entries;
create policy "log_entries: own rows" on public.log_entries
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Daily totals (History view) ----------
-- security_invoker makes the view respect the caller's RLS on log_entries.
create or replace view public.daily_totals
with (security_invoker = true) as
  select user_id,
         date,
         sum(calories) as calories,
         sum(protein)  as protein,
         sum(carbs)    as carbs,
         sum(fat)      as fat,
         count(*)      as entries
  from public.log_entries
  group by user_id, date;

grant select on public.daily_totals to authenticated;
