-- =========================================================
-- CREATORBOOK: AUTH + DB FOUNDATION (Signup/Signin Fix)
-- Paste this entire block into Supabase SQL Editor and RUN.
-- Safe to run multiple times.
-- =========================================================

-- 0) Extensions
create extension if not exists "pgcrypto";

-- 1) Tables (minimal + stable)
-- Profiles: one row per auth user
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'User',
  city text not null default 'Los Angeles',
  role text not null default 'client', -- 'client' | 'creator'
  onboarded boolean not null default false,
  approved boolean not null default false, -- only relevant for creators
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Wallet: credits balance per user
create table if not exists public.credits_wallet (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- 2) Keep updated_at fresh
create or replace function public._touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
before update on public.profiles
for each row execute function public._touch_updated_at();

drop trigger if exists trg_wallet_touch on public.credits_wallet;
create trigger trg_wallet_touch
before update on public.credits_wallet
for each row execute function public._touch_updated_at();

-- 3) Robust "new user" handler
-- - SECURITY DEFINER so it can insert regardless of RLS
-- - Never blocks signup (swallows all errors)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.profiles (id, display_name, city, role, onboarded, approved)
    values (
      new.id,
      coalesce(nullif(split_part(coalesce(new.email,''), '@', 1), ''), 'User'),
      'Los Angeles',
      'client',
      false,
      false
    )
    on conflict (id) do nothing;
  exception when others then
    null;
  end;

  begin
    insert into public.credits_wallet (user_id, balance)
    values (new.id, 0)
    on conflict (user_id) do nothing;
  exception when others then
    null;
  end;

  return new;
end;
$$;

-- 4) Trigger on auth.users
-- Nuke any broken trigger so signup can't keep 500-ing
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 5) RLS (sane defaults)
alter table public.profiles enable row level security;
alter table public.credits_wallet enable row level security;

-- PROFILES: self access
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
using (id = auth.uid());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles
for insert
with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

-- WALLET: self access
drop policy if exists wallet_select_self on public.credits_wallet;
create policy wallet_select_self
on public.credits_wallet
for select
using (user_id = auth.uid());

drop policy if exists wallet_insert_self on public.credits_wallet;
create policy wallet_insert_self
on public.credits_wallet
for insert
with check (user_id = auth.uid());

drop policy if exists wallet_update_self on public.credits_wallet;
create policy wallet_update_self
on public.credits_wallet
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- 6) Grants (helps when Supabase defaults are tightened)
-- NOTE: RLS still applies; these just allow the API to attempt access.
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles to anon, authenticated;
grant select, insert, update on public.credits_wallet to anon, authenticated;
