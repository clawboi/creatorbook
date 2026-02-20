# CreatorBook MVP v2 (GitHub Pages + Supabase) — FIXED SETUP

This is the simple MVP for LA bookings:
- Magic-link login (Supabase)
- Creator profiles + packages (music video / photography / reels / editing / fashion / producer)
- Browse creators by service + tier
- Project Cart (multi-package booking)
- Booking chat
- Delivery link + approve/release flow
- Reviews schema (ready for UI)

## What went wrong (your errors)
1) **`column "client_id" specified more than once`**  
This came from a view (`booking_card_creator`) selecting `b.*` **and** `b.client_id` again. Fixed in this version.

2) **`relation "public.bookings" does not exist`**  
That happens when the schema stopped mid-run (because of the first error), then you ran the later parts (policies/views) without the tables created yet.

## The easiest clean fix (recommended)
In Supabase, create a **fresh project** (fastest, least headache) and run the fixed schema once.

If you want to reuse the same project, run this “wipe” first:

```sql
drop view if exists public.booking_card_creator;
drop view if exists public.booking_card_client;
drop view if exists public.booking_lines;
drop view if exists public.creator_public;
drop view if exists public.reviews_public;

drop table if exists public.reviews cascade;
drop table if exists public.deliveries cascade;
drop table if exists public.messages cascade;
drop table if exists public.booking_creators cascade;
drop table if exists public.bookings cascade;
drop table if exists public.packages cascade;
drop table if exists public.credits_tx cascade;
drop table if exists public.credits_wallet cascade;
drop table if exists public.profiles cascade;
```

Then run the fixed schema in **`/supabase/schema.sql`**.

---

# Step-by-step setup (simple)

## 1) Create Supabase project
1. Create a project in Supabase.
2. Go to **SQL Editor** → **New query**.
3. Open `supabase/schema.sql` from this repo, copy ALL of it, and run it once.

## 2) Configure Auth redirect URLs
Supabase → **Authentication → URL Configuration**
- Add your GitHub Pages URL to **Redirect URLs**  
  Example: `https://YOURNAME.github.io/YOURREPO/`

(You can add localhost later if you want local testing.)

## 3) Put this repo on GitHub Pages
1. Create a new GitHub repo (public is easiest).
2. Upload these files/folders (keep structure):
   - `index.html`
   - `config.example.js`
   - `/assets/style.css`
   - `/assets/app.js`
   - `/supabase/schema.sql`
3. In GitHub: **Settings → Pages**
   - Source: **Deploy from branch**
   - Branch: `main`
   - Folder: `/ (root)`

## 4) Add your Supabase keys (config.js)
In the repo root:
1. Copy `config.example.js` → `config.js`
2. Paste your:
   - Supabase Project URL
   - Supabase anon public key

Commit.

## 5) First-time test flow
1. Open your GitHub Pages URL.
2. Sign in with your email (magic link).
3. Go to **Settings** → set Role = `creator` → Save.
4. In Supabase Table Editor → `profiles`:
   - Find your row → set `approved = true`
5. Back in the site → **Creator Tools** → create a package.
6. Sign in with a second email (client).
7. Add demo credits → browse creator → add package → request booking.
8. Creator accepts → client holds credits → creator delivers link → client approves.

That’s the full loop.

---

## Notes (MVP rules)
- Payments are demo credits for now.
- Delivery is a link (Google Drive/Dropbox/etc).
- Later: Stripe credits + payouts, dispute resolution, featured creators, ranking algorithm, calendar sync, contracts.

