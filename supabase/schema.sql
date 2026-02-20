-- CreatorBook MVP v2 schema (fixed)
-- Run in Supabase SQL editor as ONE script.

-- ===== Extensions =====
create extension if not exists pgcrypto;

-- ===== Tables =====
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'client' check (role in ('client','creator','admin')),
  approved boolean not null default false,
  display_name text not null default 'User',
  city text not null default 'Los Angeles',
  bio text not null default '',
  portfolio_url text not null default '',
  resume_url text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.credits_wallet (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.credits_tx (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  amount numeric not null,
  booking_id uuid null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  service text not null check (service in ('music_video','photography','reels','editing','fashion','producer')),
  tier text not null check (tier in ('bronze','silver','gold','elite')),
  title text not null,
  price_credits numeric not null,
  hours text not null default '',
  locations text not null default '',
  revisions text not null default '',
  delivery_days int null,
  includes text not null default '',
  addons text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested','accepted','declined','in_progress','delivered','approved','cancelled')),
  requested_date timestamptz null,
  notes text not null default '',
  total_credits numeric not null default 0,
  funded boolean not null default false,
  delivered_at timestamptz null,
  approved_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.booking_creators (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  package_id uuid not null references public.packages(id) on delete restrict,
  price_credits numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  link text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  text text not null default '',
  created_at timestamptz not null default now(),
  unique (booking_id, creator_id)
);

-- ===== Views =====
create or replace view public.reviews_public as
select r.*, p.display_name as client_name
from public.reviews r
join public.profiles p on p.id = r.client_id;

create or replace view public.creator_public as
select
  p.id as creator_id,
  p.approved,
  p.display_name,
  p.city,
  pk.service,
  pk.tier,
  min(pk.price_credits) as min_price_credits,
  coalesce(avg(r.rating)::numeric, 0) as rating_avg,
  count(r.id) as rating_count
from public.profiles p
join public.packages pk on pk.creator_id = p.id
left join public.reviews r on r.creator_id = p.id
where p.role = 'creator'
group by p.id, p.approved, p.display_name, p.city, pk.service, pk.tier;

create or replace view public.booking_lines as
select
  bc.booking_id,
  bc.creator_id,
  pr.display_name as creator_name,
  pk.service,
  pk.tier,
  pk.title as package_title,
  bc.price_credits
from public.booking_creators bc
join public.profiles pr on pr.id = bc.creator_id
join public.packages pk on pk.id = bc.package_id;

create or replace view public.booking_card_client as
select
  b.*,
  (select pr.display_name
   from public.booking_creators bc
   join public.profiles pr on pr.id = bc.creator_id
   where bc.booking_id = b.id
   limit 1) as counterparty_name,
  (select pk.service
   from public.booking_creators bc
   join public.packages pk on pk.id = bc.package_id
   where bc.booking_id = b.id
   limit 1) as service,
  (select pk.tier
   from public.booking_creators bc
   join public.packages pk on pk.id = bc.package_id
   where bc.booking_id = b.id
   limit 1) as tier,
  (select pk.title
   from public.booking_creators bc
   join public.packages pk on pk.id = bc.package_id
   where bc.booking_id = b.id
   limit 1) as title_line
from public.bookings b;

-- NOTE: this view returns 1 row per booking line (so a creator sees only their attached projects)
-- Fixed: removed duplicate "b.client_id" (b.* already includes it)
create or replace view public.booking_card_creator as
select
  b.*,
  (select pr.display_name from public.profiles pr where pr.id = b.client_id) as counterparty_name,
  (select pk.service
   from public.booking_creators bc2
   join public.packages pk on pk.id = bc2.package_id
   where bc2.booking_id = b.id
   limit 1) as service,
  (select pk.tier
   from public.booking_creators bc2
   join public.packages pk on pk.id = bc2.package_id
   where bc2.booking_id = b.id
   limit 1) as tier,
  (select pk.title
   from public.booking_creators bc2
   join public.packages pk on pk.id = bc2.package_id
   where bc2.booking_id = b.id
   limit 1) as title_line,
  bc.creator_id
from public.bookings b
join public.booking_creators bc on bc.booking_id = b.id;

-- ===== RLS =====
alter table public.profiles enable row level security;
alter table public.credits_wallet enable row level security;
alter table public.credits_tx enable row level security;
alter table public.packages enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_creators enable row level security;
alter table public.messages enable row level security;
alter table public.deliveries enable row level security;
alter table public.reviews enable row level security;

-- Profiles: users can read approved creators + self; update self
drop policy if exists "profiles_read_self_or_approved" on public.profiles;
create policy "profiles_read_self_or_approved"
on public.profiles for select
using ( id = auth.uid() or (role='creator' and approved=true) );

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles for insert
with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

-- Wallet: self only
drop policy if exists "wallet_self" on public.credits_wallet;
create policy "wallet_self"
on public.credits_wallet for select
using (user_id = auth.uid());

drop policy if exists "wallet_upsert_self" on public.credits_wallet;
create policy "wallet_upsert_self"
on public.credits_wallet for insert
with check (user_id = auth.uid());

drop policy if exists "wallet_update_self" on public.credits_wallet;
create policy "wallet_update_self"
on public.credits_wallet for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Credits tx: self only
drop policy if exists "tx_self" on public.credits_tx;
create policy "tx_self"
on public.credits_tx for select
using (user_id = auth.uid());

drop policy if exists "tx_insert_self" on public.credits_tx;
create policy "tx_insert_self"
on public.credits_tx for insert
with check (user_id = auth.uid());

-- Packages: approved creators visible to all authed users; creators manage their own
drop policy if exists "packages_read_approved_creators" on public.packages;
create policy "packages_read_approved_creators"
on public.packages for select
using (
  exists(select 1 from public.profiles p where p.id = creator_id and p.role='creator' and p.approved=true)
  or creator_id = auth.uid()
);

drop policy if exists "packages_insert_creator_self" on public.packages;
create policy "packages_insert_creator_self"
on public.packages for insert
with check (creator_id = auth.uid());

drop policy if exists "packages_update_creator_self" on public.packages;
create policy "packages_update_creator_self"
on public.packages for update
using (creator_id = auth.uid())
with check (creator_id = auth.uid());

-- Bookings: client or attached creator can read; client can create; client/creator can update status
drop policy if exists "bookings_read_party" on public.bookings;
create policy "bookings_read_party"
on public.bookings for select
using (
  client_id = auth.uid()
  or exists(select 1 from public.booking_creators bc where bc.booking_id = id and bc.creator_id = auth.uid())
);

drop policy if exists "bookings_insert_client" on public.bookings;
create policy "bookings_insert_client"
on public.bookings for insert
with check (client_id = auth.uid());

drop policy if exists "bookings_update_party" on public.bookings;
create policy "bookings_update_party"
on public.bookings for update
using (
  client_id = auth.uid()
  or exists(select 1 from public.booking_creators bc where bc.booking_id = id and bc.creator_id = auth.uid())
);

-- booking_creators: parties can read; client can insert lines for their booking
drop policy if exists "booking_creators_read_party" on public.booking_creators;
create policy "booking_creators_read_party"
on public.booking_creators for select
using (
  exists(select 1 from public.bookings b where b.id = booking_id and b.client_id = auth.uid())
  or creator_id = auth.uid()
);

drop policy if exists "booking_creators_insert_client" on public.booking_creators;
create policy "booking_creators_insert_client"
on public.booking_creators for insert
with check (
  exists(select 1 from public.bookings b where b.id = booking_id and b.client_id = auth.uid())
);

-- messages: parties can read/write
drop policy if exists "messages_read_party" on public.messages;
create policy "messages_read_party"
on public.messages for select
using (
  exists(select 1 from public.bookings b where b.id = booking_id and b.client_id = auth.uid())
  or exists(select 1 from public.booking_creators bc where bc.booking_id = booking_id and bc.creator_id = auth.uid())
);

drop policy if exists "messages_insert_party" on public.messages;
create policy "messages_insert_party"
on public.messages for insert
with check (
  sender_id = auth.uid()
  and (
    exists(select 1 from public.bookings b where b.id = booking_id and b.client_id = auth.uid())
    or exists(select 1 from public.booking_creators bc where bc.booking_id = booking_id and bc.creator_id = auth.uid())
  )
);

-- deliveries: parties can read; creators attached can insert
drop policy if exists "deliveries_read_party" on public.deliveries;
create policy "deliveries_read_party"
on public.deliveries for select
using (
  exists(select 1 from public.bookings b where b.id = booking_id and b.client_id = auth.uid())
  or exists(select 1 from public.booking_creators bc where bc.booking_id = booking_id and bc.creator_id = auth.uid())
);

drop policy if exists "deliveries_insert_creator_party" on public.deliveries;
create policy "deliveries_insert_creator_party"
on public.deliveries for insert
with check (
  exists(select 1 from public.booking_creators bc where bc.booking_id = booking_id and bc.creator_id = auth.uid())
);

-- reviews: anyone can read; client can insert after approval
drop policy if exists "reviews_read_all" on public.reviews;
create policy "reviews_read_all"
on public.reviews for select
using (true);

drop policy if exists "reviews_insert_client" on public.reviews;
create policy "reviews_insert_client"
on public.reviews for insert
with check (
  client_id = auth.uid()
  and exists(
    select 1 from public.bookings b
    where b.id = booking_id and b.client_id = auth.uid() and b.status='approved'
  )
);
