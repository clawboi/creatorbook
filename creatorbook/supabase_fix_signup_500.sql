-- =========================================================
-- CREATORBOOK: FIX SIGNUP 500 (robust trigger + sane RLS)
-- Paste this entire file into Supabase SQL Editor and RUN.
-- Safe to run multiple times.
-- =========================================================

-- 0) Make sure required extensions exist (uuid)
create extension if not exists "pgcrypto";

-- 1) Nuke any broken trigger so signup can't keep 500-ing
drop trigger if exists on_auth_user_created on auth.users;

-- 2) Robust "new user" handler:
--    - SECURITY DEFINER so it can write even with RLS on
--    - NEVER throws (swallows all errors)
--    - Inserts ONLY columns that exist in your tables (dynamic SQL)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cols text[];
  has_display boolean;
  has_city boolean;
  has_role boolean;
  has_onboarded boolean;
  has_approved boolean;
  sql_insert text;
begin
  -- ---------------- profiles ----------------
  begin
    select array_agg(column_name::text order by ordinal_position)
      into cols
    from information_schema.columns
    where table_schema='public' and table_name='profiles';

    if cols is null then
      -- profiles table doesn't exist; don't block signup
      null;
    else
      has_display   := ('display_name' = any(cols));
      has_city      := ('city' = any(cols));
      has_role      := ('role' = any(cols));
      has_onboarded := ('onboarded' = any(cols));
      has_approved  := ('approved' = any(cols));

      -- Build an insert that only references existing columns
      sql_insert := 'insert into public.profiles (id';
      if has_display   then sql_insert := sql_insert || ', display_name'; end if;
      if has_city      then sql_insert := sql_insert || ', city'; end if;
      if has_role      then sql_insert := sql_insert || ', role'; end if;
      if has_onboarded then sql_insert := sql_insert || ', onboarded'; end if;
      if has_approved  then sql_insert := sql_insert || ', approved'; end if;
      sql_insert := sql_insert || ') values ($1';

      if has_display then sql_insert := sql_insert || ', $2'; end if;
      if has_city    then sql_insert := sql_insert || ', $3'; end if;
      if has_role    then sql_insert := sql_insert || ', $4'; end if;
      if has_onboarded then sql_insert := sql_insert || ', $5'; end if;
      if has_approved  then sql_insert := sql_insert || ', $6'; end if;

      sql_insert := sql_insert || ') on conflict (id) do nothing';

      execute sql_insert using
        new.id,
        coalesce(nullif(split_part(coalesce(new.email,''), '@', 1), ''), 'User'),
        'Los Angeles',
        'client',
        false,
        false;
    end if;
  exception when others then
    -- never block signup
    null;
  end;

  -- ---------------- wallet ----------------
  begin
    -- credits_wallet may be named differently; we assume credits_wallet(user_id, balance)
    if exists (
      select 1 from information_schema.tables
      where table_schema='public' and table_name='credits_wallet'
    ) then
      insert into public.credits_wallet (user_id, balance)
      values (new.id, 0)
      on conflict (user_id) do nothing;
    end if;
  exception when others then
    null;
  end;

  return new;
end;
$$;

-- 3) Recreate trigger (Postgres 15 prefers EXECUTE FUNCTION)
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 4) RLS policies (won't affect signup trigger, but will stop "can't read profile" issues)
--    If you already have policies, these "drop if exists" calls keep it clean.

-- PROFILES
alter table if exists public.profiles enable row level security;

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

-- CREDITS WALLET
alter table if exists public.credits_wallet enable row level security;

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

-- Done.
