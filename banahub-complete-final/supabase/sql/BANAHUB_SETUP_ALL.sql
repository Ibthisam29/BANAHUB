-- BANAHUB_SETUP_ALL.sql — one-shot setup for project mfqdqisbryoepdpqebkb
-- Paste into Supabase → SQL Editor → Run. Safe to run more than once.
-- Contains 02 → 09 (01_base_schema is already applied on the live project).
-- After it finishes, register on the website with your email, then run the
-- "MAKE ME ADMIN" line at the very bottom.


-- ═══════════════════════ 02_security_hardening.sql ═══════════════════════
-- BANAHub — Security hardening
-- Run in Supabase SQL Editor (project: mfqdqisbryoepdpqebkb)

-- ══════════════════════════════════════════════════════════════════
-- PAYMENTS — transactions table (idempotent; same table used across
-- programs, events, and FundMatch contact unlocks)
-- ══════════════════════════════════════════════════════════════════
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  email text,                          -- for guest checkouts pre-auth
  type text not null,                  -- 'program_payment','event_registration','contact_unlock','subscription'
  item_type text,                      -- 'program' | 'event'
  item_id uuid,
  amount numeric not null,
  currency text default 'SGD',
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  status text default 'pending',       -- pending, completed, failed, refunded
  created_at timestamptz default now()
);
alter table transactions enable row level security;

drop policy if exists "transactions_owner_read" on transactions;
create policy "transactions_owner_read" on transactions
  for select using (auth.uid() = user_id);

drop policy if exists "transactions_admin_read" on transactions;
create policy "transactions_admin_read" on transactions
  for select using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

-- Guest checkout confirmation: status lookup by exact session_id only.
-- Deliberately NOT an RLS policy (a "using (true)" policy would expose
-- the whole table via anon SELECT) — instead a narrow function that
-- returns just the status string for one row.
create or replace function get_transaction_status(p_session_id text)
returns text
language plpgsql
security definer
as $$
declare
  v_status text;
begin
  select status into v_status from transactions where stripe_session_id = p_session_id;
  return coalesce(v_status, 'error');
end;
$$;
grant execute on function get_transaction_status(text) to anon, authenticated;

-- No client insert/update policy on purpose — only the stripe-webhook
-- Edge Function (using the service_role key, which bypasses RLS) may
-- write transactions. This is the actual security boundary: a client
-- can never mark its own payment as "completed".

-- ══════════════════════════════════════════════════════════════════
-- SITE SETTINGS / SEO / PAGES / NOTIFICATIONS
-- (Settings & SEO Save buttons previously did nothing at all — the
--  toast said "Saved" but no data was ever persisted anywhere.)
-- ══════════════════════════════════════════════════════════════════
create table if not exists site_settings (
  key text primary key,        -- 'general' | 'branding' | 'email' | 'seo'
  value jsonb not null default '{}',
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);
alter table site_settings enable row level security;

drop policy if exists "site_settings_public_read" on site_settings;
create policy "site_settings_public_read" on site_settings
  for select using (true);  -- general/branding/seo drive the public site's own rendering

drop policy if exists "site_settings_admin_write" on site_settings;
create policy "site_settings_admin_write" on site_settings
  for all using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

-- The `pages` table already existed before this migration (used by
-- admin.html's page-content editor: slug + sections jsonb). Confirm it
-- has RLS enabled with an admin-write policy — if not, run:
--   alter table pages enable row level security;
--   create policy "pages_public_read" on pages for select using (true);
--   create policy "pages_admin_write" on pages for all using (
--     exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
--   );

create table if not exists admin_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  read boolean default false,
  created_at timestamptz default now()
);
alter table admin_notifications enable row level security;
drop policy if exists "admin_notifications_admin_all" on admin_notifications;
create policy "admin_notifications_admin_all" on admin_notifications for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- PARTNERS / ACCESS REQUESTS / ENQUIRIES / ACTIVITY LOGS
-- (the last 4 stubbed admin panels)
-- ══════════════════════════════════════════════════════════════════
create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text default 'Ecosystem Partner',
  tier text default 'standard',
  logo_url text,
  website text,
  description text,
  published boolean default true,
  created_at timestamptz default now()
);
alter table partners enable row level security;
drop policy if exists "partners_public_read" on partners;
create policy "partners_public_read" on partners for select using (published = true);
drop policy if exists "partners_admin_all" on partners;
create policy "partners_admin_all" on partners for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references auth.users(id),
  requester_name text,
  requester_email text,
  target_type text,           -- 'company' | 'dataroom' | 'business_profile'
  target_id uuid,
  target_label text,          -- display name, avoids extra joins in the admin list
  status text default 'pending',  -- pending, approved, rejected
  expires_at timestamptz,
  review_notes text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);
alter table access_requests enable row level security;
drop policy if exists "access_requests_own_read" on access_requests;
create policy "access_requests_own_read" on access_requests for select using (auth.uid() = requester_id);
drop policy if exists "access_requests_own_insert" on access_requests;
create policy "access_requests_own_insert" on access_requests for insert with check (auth.uid() = requester_id);
drop policy if exists "access_requests_admin_all" on access_requests;
create policy "access_requests_admin_all" on access_requests for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  company text,
  message text,
  source text default 'contact_form',  -- contact_form, briefing_request, event, program
  status text default 'new',           -- new, in_progress, resolved
  created_at timestamptz default now()
);
alter table enquiries enable row level security;
drop policy if exists "enquiries_insert_anyone" on enquiries;
create policy "enquiries_insert_anyone" on enquiries for insert with check (true);
drop policy if exists "enquiries_admin_all" on enquiries;
create policy "enquiries_admin_all" on enquiries for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_email text,
  action text not null,        -- 'auth.login','access.approve','admin.page_save', etc.
  category text,                -- 'auth','access','admin','profile','payment' — matches the panel filter
  description text,
  created_at timestamptz default now()
);
alter table activity_logs enable row level security;
drop policy if exists "activity_logs_insert_authenticated" on activity_logs;
create policy "activity_logs_insert_authenticated" on activity_logs for insert with check (auth.role() = 'authenticated');
drop policy if exists "activity_logs_admin_read" on activity_logs;
create policy "activity_logs_admin_read" on activity_logs for select using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- PROGRAMS TABLE (was missing — admin panel was fully stubbed)
-- ══════════════════════════════════════════════════════════════════
create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text default 'Cohort',
  status text default 'draft',        -- draft, upcoming, active, closed
  start_date date,
  end_date date,
  region text,
  description text,
  max_participants int,
  price_amount numeric default 0,     -- 0 = free
  currency text default 'SGD',
  published boolean default false,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);
alter table programs enable row level security;

-- events also needs a price for paid registrations (Capital & Growth
-- Exchange showcase slots, private dinner, etc). Add if missing:
alter table events add column if not exists price_amount numeric default 0;
alter table events add column if not exists currency text default 'SGD';

-- ══════════════════════════════════════════════════════════════════
-- LUMA INTEGRATION — invite-only, RSVP, ticketing managed via Luma
-- ══════════════════════════════════════════════════════════════════
alter table events add column if not exists luma_event_id text;
alter table events add column if not exists luma_url text;
alter table events add column if not exists invite_only boolean default false;
alter table events add column if not exists require_approval boolean default false;

-- Local cache of Luma's guest list, synced on demand (or via webhook
-- if you wire one in Luma's dashboard) — lets admin see RSVPs without
-- leaving BANAHub admin.
create table if not exists event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  luma_guest_id text,
  name text,
  email text,
  approval_status text,   -- 'approved','pending','declined','waitlisted'
  checked_in boolean default false,
  synced_at timestamptz default now(),
  unique(event_id, luma_guest_id)
);
alter table event_rsvps enable row level security;

drop policy if exists "event_rsvps_admin_all" on event_rsvps;
create policy "event_rsvps_admin_all" on event_rsvps
  for all using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

drop policy if exists "programs_public_read" on programs;
create policy "programs_public_read" on programs
  for select using (published = true);

drop policy if exists "programs_admin_all" on programs;
create policy "programs_admin_all" on programs
  for all using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

-- Same policy pattern should exist on `events` — confirm it does; if not:
-- create policy "events_public_read" on events for select using (published = true);
-- create policy "events_admin_all" on events for all using (
--   exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
-- );

-- ══════════════════════════════════════════════════════════════════
-- LOGIN ATTEMPT LOGGING + RATE LIMITING
-- ══════════════════════════════════════════════════════════════════
create table if not exists login_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  success boolean not null,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);
alter table login_attempts enable row level security;

-- Anyone (including anon, pre-auth) can INSERT an attempt record — this is
-- how failed logins get logged before a session exists. No SELECT for anon.
drop policy if exists "login_attempts_insert_anyone" on login_attempts;
create policy "login_attempts_insert_anyone" on login_attempts
  for insert with check (true);

drop policy if exists "login_attempts_admin_read" on login_attempts;
create policy "login_attempts_admin_read" on login_attempts
  for select using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

-- Rate-limit check: call BEFORE attempting sign-in from the client.
-- Blocks after 5 failed attempts for the same email within 15 minutes.
create or replace function check_login_rate_limit(p_email text)
returns boolean
language plpgsql
security definer
as $$
declare
  fail_count int;
begin
  select count(*) into fail_count
  from login_attempts
  where email = p_email
    and success = false
    and created_at > now() - interval '15 minutes';
  return fail_count < 5;
end;
$$;

-- Allow anon to call the rate-limit check (read-only, no data exposure)
grant execute on function check_login_rate_limit(text) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- ADMIN LOGIN ALERT — trigger fires on every INSERT into login_attempts
-- targeting the admin route, calls an Edge Function via pg_net which
-- emails the owner. Requires the "notify-admin-login-attempt" Edge
-- Function to be deployed (see edge-function-notify-admin.ts) and the
-- pg_net extension enabled (Database → Extensions → pg_net).
-- ══════════════════════════════════════════════════════════════════
create extension if not exists pg_net;

create or replace function notify_admin_on_login_attempt()
returns trigger
language plpgsql
security definer
as $$
declare
  is_admin_email boolean;
begin
  -- Server-side check: is this email actually an admin account?
  -- (never trust a client-supplied "is this the admin route" flag)
  select exists(
    select 1 from users u
    where u.email = new.email and u.role = 'admin'
  ) into is_admin_email;

  if is_admin_email then
    perform net.http_post(
      url := 'https://mfqdqisbryoepdpqebkb.supabase.co/functions/v1/notify-admin-login-attempt',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'email', new.email,
        'success', new.success,
        'ip_address', new.ip_address,
        'user_agent', new.user_agent,
        'created_at', new.created_at
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_admin_login on login_attempts;
create trigger trg_notify_admin_login
  after insert on login_attempts
  for each row execute function notify_admin_on_login_attempt();


-- ═══════════════════════ 03_sponsorship_packages.sql ═══════════════════════
-- Sponsorship Packages — added on top of base_schema.sql + security_hardening.sql
-- Run in Supabase SQL editor after those two.

create table if not exists sponsorship_packages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,  -- nullable: null = standing/general sponsorship, not tied to one event
  name text not null,
  format text not null default 'virtual',      -- 'virtual' | 'in_person'
  category text not null default 'general',    -- 'general' | 'speaking' | 'booth'
  description text,
  inclusions text[],                            -- bullet list of what's included
  price_amount numeric not null default 0,
  currency text default 'USD',
  max_slots int,                                 -- optional cap (e.g. only 3 speaking slots)
  slots_taken int default 0,
  published boolean default true,
  created_at timestamptz default now()
);
alter table sponsorship_packages enable row level security;

drop policy if exists "sponsorship_packages_public_read" on sponsorship_packages;
create policy "sponsorship_packages_public_read" on sponsorship_packages
  for select using (published = true);

drop policy if exists "sponsorship_packages_admin_all" on sponsorship_packages;
create policy "sponsorship_packages_admin_all" on sponsorship_packages
  for all using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

-- Seed: the two sponsorship tracks requested, each with speaking + booth
-- variants where it makes sense (booth only applies in-person).
-- Edit prices in Admin → Sponsorship after this runs — placeholders below.
insert into sponsorship_packages (name, format, category, description, inclusions, price_amount, currency, published)
select * from (values
  ('Virtual Event Sponsorship', 'virtual', 'general',
   'Brand visibility and audience access across a virtual event — logo placement, mention in opening remarks, and post-event attendee report.',
   array['Logo on virtual event platform', 'Mention in opening remarks', 'Post-event attendee report', 'Social media shoutout'],
   0, 'USD', false),

  ('Virtual Speaking Slot', 'virtual', 'speaking',
   'A dedicated speaking slot within the virtual programme — present directly to the attending audience.',
   array['10-minute speaking slot', 'Q&A session', 'Session recording rights', 'Everything in Virtual Event Sponsorship'],
   0, 'USD', false),

  ('In-Person Sponsorship', 'in_person', 'general',
   'On-the-ground brand presence at the physical event — signage, materials placement, and attendee list access.',
   array['Event signage placement', 'Materials in delegate bags', 'Attendee list (opt-in)', 'Logo on event backdrop'],
   0, 'USD', false),

  ('In-Person Speaking Slot', 'in_person', 'speaking',
   'A speaking slot on the main stage or a breakout session at the physical event.',
   array['Stage or breakout speaking slot', 'Speaker bio in programme', 'Professional photography', 'Everything in In-Person Sponsorship'],
   0, 'USD', false),

  ('In-Person Booth', 'in_person', 'booth',
   'A dedicated booth space at the physical event for direct attendee engagement.',
   array['Booth space (table + 2 chairs)', 'Listed on event floor plan', 'Two staff passes', 'Everything in In-Person Sponsorship'],
   0, 'USD', false)) v(name, format, category, description, inclusions, price_amount, currency, published)
where not exists (select 1 from sponsorship_packages);

-- These 5 rows are seeded as UNPUBLISHED (published = false) with $0
-- placeholder pricing on purpose — real prices need to be set before
-- they go live. Set prices + flip published = true in Admin →
-- Sponsorship, or run:
--   update sponsorship_packages set price_amount = 2500, published = true where name = 'Virtual Event Sponsorship';


-- ═══════════════════════ 04_pitch_readiness_service.sql ═══════════════════════
-- Add: Founder Pitch Readiness Audit — flat-fee advisory service
insert into programs (title, type, status, description, price_amount, currency, published)
select
  'Founder Pitch Readiness Audit',
  'Advisory',
  'active',
  'A structured review of your pitch deck, narrative, and investor positioning — flagging gaps before you''re in the room with capital. Flat-fee, single-session audit.',
  82,
  'USD',
  true
where not exists (select 1 from programs where title = 'Founder Pitch Readiness Audit');


-- ═══════════════════════ 05_admin_expansion.sql ═══════════════════════
-- User block/unblock
alter table users add column if not exists blocked boolean default false;
alter table users add column if not exists blocked_at timestamptz;
alter table users add column if not exists blocked_reason text;

-- Network directory: LinkedIn + searchable fields
alter table investors add column if not exists linkedin_url text;
alter table investors add column if not exists full_name text;
alter table investors add column if not exists email text;
alter table investors add column if not exists organization text;
alter table investors add column if not exists check_size text;
alter table investors add column if not exists geography text;

alter table companies add column if not exists linkedin_url text;
alter table companies add column if not exists contact_name text;
alter table companies add column if not exists email text;
alter table companies add column if not exists website text;
alter table companies add column if not exists description text;

-- Deal Room / Strategy planner fields
alter table deal_rooms add column if not exists name text;
alter table deal_rooms add column if not exists industry text;
alter table deal_rooms add column if not exists investment_type text;   -- equity, debt, convertible, SAFE, etc.
alter table deal_rooms add column if not exists target_raise numeric;
alter table deal_rooms add column if not exists currency text default 'USD';
alter table deal_rooms add column if not exists stage text;             -- pre-seed, seed, series A, etc.
alter table deal_rooms add column if not exists notes text;

-- Event video support
alter table events add column if not exists video_url text;





-- ═══════════════════════ 07_pricing_catalog.sql ═══════════════════════
-- 07_pricing_catalog.sql
-- Central pricing catalog — admin controls prices, Stripe Price IDs and
-- Payment Links for all products, services, events and memberships.
-- Safe to run multiple times (IF NOT EXISTS / upsert).

create table if not exists pricing_catalog (
  id            uuid primary key default gen_random_uuid(),
  category      text not null,          -- membership | program | event | service | advisory | sponsorship
  name          text not null,          -- display label
  description   text,
  price_amount  numeric not null default 0,
  currency      text not null default 'SGD',
  billing_cycle text default 'one_time', -- one_time | monthly | annual
  stripe_price_id    text,              -- price_... created by admin
  stripe_payment_link text,             -- https://buy.stripe.com/... auto-generated
  stripe_product_id   text,             -- prod_...
  active        boolean default true,
  sort_order    int default 0,
  metadata      jsonb default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- RLS
alter table pricing_catalog enable row level security;

-- Public can read active prices (for checkout page display)
drop policy if exists "pricing_public_read" on pricing_catalog;
create policy "pricing_public_read" on pricing_catalog
  for select using (active = true);

-- Admin full control
drop policy if exists "pricing_admin_all" on pricing_catalog;
create policy "pricing_admin_all" on pricing_catalog
  for all using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

-- updated_at trigger
create or replace function set_pricing_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists pricing_catalog_updated_at on pricing_catalog;
create trigger pricing_catalog_updated_at
  before update on pricing_catalog
  for each row execute function set_pricing_updated_at();

-- Seed default BANAHUB pricing (safe to re-run via ON CONFLICT DO NOTHING on name+category)
alter table pricing_catalog add column if not exists _seed_key text unique;

insert into pricing_catalog (category, name, description, price_amount, currency, billing_cycle, sort_order, _seed_key) values
  ('membership', 'BANAHub Monthly',   'Full platform access, monthly billing',     8,    'USD', 'monthly',  1,  'seed_membership_monthly'),
  ('membership', 'BANAHub Annual',    'Full platform access, annual billing',       88,   'USD', 'annual',   2,  'seed_membership_annual'),
  ('advisory',   'Market Entry Advisory',      'Singapore/SEA market entry scoping & GTM',  2500, 'SGD', 'one_time', 10, 'seed_advisory_entry'),
  ('advisory',   'Investor Readiness Package', 'Deck, data room, IM, pitch coaching',       4500, 'SGD', 'one_time', 11, 'seed_advisory_ir'),
  ('advisory',   'Capital Introduction Fee',   'Success fee — milestone-based',              0,    'SGD', 'one_time', 12, 'seed_advisory_cap'),
  ('service',    'FundMatch Listing',          'Campaign listing on FundMatch platform',     500,  'SGD', 'one_time', 20, 'seed_service_fundmatch'),
  ('service',    'Contact Unlock',             'Single contact reveal token',                15,   'USD', 'one_time', 21, 'seed_service_contact'),
  ('event',      'Capital & Growth Exchange',  'BANAHUB flagship event — Nov 2026',          350,  'SGD', 'one_time', 30, 'seed_event_cge'),
  ('sponsorship','Gold Sponsorship',           'Premium event sponsor package',              8000, 'SGD', 'one_time', 40, 'seed_sponsor_gold'),
  ('sponsorship','Silver Sponsorship',         'Standard event sponsor package',             4000, 'SGD', 'one_time', 41, 'seed_sponsor_silver'),
  ('sponsorship','Bronze Sponsorship',         'Entry sponsor package',                      2000, 'SGD', 'one_time', 42, 'seed_sponsor_bronze')
on conflict (_seed_key) do nothing;

-- Add price_amount / stripe_price_id guards to programs and events tables
alter table programs add column if not exists price_amount numeric default 0;
alter table programs add column if not exists currency text default 'SGD';
alter table programs add column if not exists stripe_price_id text;
alter table programs add column if not exists stripe_payment_link text;

alter table events add column if not exists price_amount numeric default 0;
alter table events add column if not exists currency text default 'SGD';
alter table events add column if not exists stripe_price_id text;
alter table events add column if not exists stripe_payment_link text;


-- ═══════════════════════ 08_admin_cms_capital.sql ═══════════════════════
-- 08_admin_cms_capital.sql
-- Admin OS v3: visual page CMS, event pages, memberships, capital raises,
-- investor directory + CSV/Excel import, investor matching.
-- Run AFTER 01–05 and 07. Idempotent — safe to run more than once.
-- Admin checks use: exists(select 1 from users u where u.id = auth.uid() and u.role = 'admin')

-- ══════════════════════════════════════════════════════════════════
-- ARTICLES — fields the admin blog editor uses
-- ══════════════════════════════════════════════════════════════════
alter table articles add column if not exists author_name text;
alter table articles add column if not exists category text;
alter table articles add column if not exists meta_description text;
alter table articles add column if not exists tags text;
alter table articles add column if not exists status text default 'draft';
alter table articles add column if not exists publish_date date;
alter table articles add column if not exists updated_at timestamptz default now();

-- ══════════════════════════════════════════════════════════════════
-- EVENTS — detail page link fields
-- ══════════════════════════════════════════════════════════════════
alter table events add column if not exists slug text;
alter table events add column if not exists page_url text;      -- custom landing page, e.g. /capital-growth-exchange
alter table events add column if not exists video_url text;
create unique index if not exists events_slug_key on events(slug) where slug is not null;

-- Link the flagship event to its dedicated landing page (no-op if absent)
update events set page_url = '/capital-growth-exchange'
 where page_url is null and title ilike '%capital%growth%exchange%';

-- ══════════════════════════════════════════════════════════════════
-- INVESTORS — directory + matching fields
--   status: 'directory' = admin-only (imported); 'approved' = visible in
--   the public directory via investors_public_approved_read; 'pending'.
-- ══════════════════════════════════════════════════════════════════
alter table investors add column if not exists focus_sectors text[];
alter table investors add column if not exists preferred_stages text[];
alter table investors add column if not exists check_min numeric;
alter table investors add column if not exists check_max numeric;
alter table investors add column if not exists phone text;
alter table investors add column if not exists website text;
alter table investors add column if not exists notes text;
alter table investors add column if not exists source text;
alter table investors add column if not exists updated_at timestamptz default now();
create index if not exists investors_email_idx on investors (lower(email));
create index if not exists investors_status_idx on investors (status);

-- ══════════════════════════════════════════════════════════════════
-- COMPANIES
-- ══════════════════════════════════════════════════════════════════
alter table companies add column if not exists source text;
alter table companies add column if not exists updated_at timestamptz default now();
create index if not exists companies_email_idx on companies (lower(email));

-- ══════════════════════════════════════════════════════════════════
-- CAPITAL RAISES (deal_rooms)
-- ══════════════════════════════════════════════════════════════════
alter table deal_rooms add column if not exists company_name text;
alter table deal_rooms add column if not exists sectors text[];
alter table deal_rooms add column if not exists geography text;
alter table deal_rooms add column if not exists raised_amount numeric;
alter table deal_rooms add column if not exists min_ticket numeric;
alter table deal_rooms add column if not exists close_date date;
alter table deal_rooms add column if not exists description text;
alter table deal_rooms add column if not exists deck_url text;          -- admin-only (not in member view)
alter table deal_rooms add column if not exists shortlist jsonb default '[]'::jsonb; -- admin-only
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'deal_rooms' and column_name = 'published') then
    alter table deal_rooms add column published boolean default false;
    -- first run only: keep raises that were already open visible on the dashboard
    update deal_rooms set published = true where status = 'open';
  end if;
end $$;
alter table deal_rooms add column if not exists updated_at timestamptz default now();

-- Members see ONLY safe columns of published + open raises, through this view.
-- (deal_rooms RLS stays member-of-room only; deck_url / notes / shortlist never exposed.)
drop view if exists member_capital_raises;
create view member_capital_raises as
  select d.id,
         coalesce(d.name, d.company_name, c.company_name) as name,
         coalesce(d.company_name, c.company_name)         as company_name,
         d.industry, d.sectors, d.investment_type, d.stage, d.target_raise, d.raised_amount,
         d.min_ticket, d.currency, d.geography, d.close_date, d.description, d.status, d.created_at
    from deal_rooms d
    left join companies c on c.id = d.company_id
   where d.status = 'open' and d.published = true;
revoke all on member_capital_raises from anon, public;
grant select on member_capital_raises to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- SUBSCRIPTIONS — one row per user so checkout + webhook upserts work
-- ══════════════════════════════════════════════════════════════════
alter table subscriptions add column if not exists billing text;
alter table subscriptions add column if not exists email text;
alter table subscriptions add column if not exists updated_at timestamptz default now();

-- de-duplicate (keep newest per user) before adding the unique constraint
delete from subscriptions s
 using subscriptions s2
 where s.user_id = s2.user_id and s.user_id is not null
   and (s.created_at, s.id::text) < (s2.created_at, s2.id::text);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_user_id_key') then
    alter table subscriptions add constraint subscriptions_user_id_key unique (user_id);
  end if;
end $$;

-- Members may record their own PENDING subscription at checkout.
-- Only the stripe-webhook (service_role) can set status = 'active'.
drop policy if exists "subscriptions_own_pending_insert" on subscriptions;
create policy "subscriptions_own_pending_insert" on subscriptions
  for insert with check (auth.uid() = user_id and status = 'pending');
drop policy if exists "subscriptions_own_pending_update" on subscriptions;
create policy "subscriptions_own_pending_update" on subscriptions
  for update using (auth.uid() = user_id and status in ('pending', 'cancelled'))
  with check (auth.uid() = user_id and status = 'pending');

create index if not exists idx_subscriptions_stripe_sub on subscriptions(stripe_subscription_id);

-- ══════════════════════════════════════════════════════════════════
-- TRANSACTIONS — lookup indexes (table + RLS defined in 02; admin is
-- read-only there — status changes stay webhook-only)
-- ══════════════════════════════════════════════════════════════════
create index if not exists idx_transactions_user_id on transactions(user_id);
create index if not exists idx_transactions_type on transactions(type);

-- ══════════════════════════════════════════════════════════════════
-- PAGES — CMS overrides live in pages.sections (cms_draft / cms_published /
-- cms_meta). Ensure policies exist (public read, admin write).
-- ══════════════════════════════════════════════════════════════════
alter table pages add column if not exists updated_at timestamptz default now();
drop policy if exists "pages_public_read" on pages;
create policy "pages_public_read" on pages for select using (true);
drop policy if exists "pages_admin_write" on pages;
create policy "pages_admin_write" on pages for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
) with check (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);


-- ═══════════════════════ 09_auth_hardening.sql ═══════════════════════
-- 09_auth_hardening.sql
-- Fixes in the base `users` table policies. Run after 01–08. Idempotent.
--
-- 1. RECURSION: "users_admin_all" queried `users` from inside a policy ON
--    `users` → Postgres raises "infinite recursion detected in policy for
--    relation users" for every authenticated query that touches any table
--    whose admin policy checks users.role. is_admin() is SECURITY DEFINER,
--    so it reads users without re-entering RLS. Other tables keep their
--    exists(select 1 from users u where u.id = auth.uid() and u.role = 'admin')
--    check, which now resolves cleanly.
-- 2. PRIVILEGE ESCALATION: "users_own_update" let any member set their own
--    role = 'admin'. A trigger now blocks non-admins from changing
--    role / status / blocked fields (on insert or update).
-- 3. SIGNUP: no INSERT policy existed, so /auth/register could never create
--    the member's users row. Members may insert ONLY their own row, never as admin.
-- 4. Columns the register form already sends.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "users_admin_all" on users;
create policy "users_admin_all" on users for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "users_own_insert" on users;
create policy "users_own_insert" on users for insert
  with check (auth.uid() = id and coalesce(role, 'applicant') <> 'admin' and coalesce(status, 'pending') = 'pending');

drop policy if exists "users_own_update" on users;
create policy "users_own_update" on users for update
  using (auth.uid() = id) with check (auth.uid() = id);

alter table users add column if not exists country text;
alter table users add column if not exists phone text;

-- Role / status protection: only admins (or server-side code with no JWT,
-- e.g. SQL editor / service_role) may change these fields.
create or replace function public.protect_user_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.role, 'applicant') = 'admin' then
      raise exception 'not allowed to self-assign admin role';
    end if;
    new.status := 'pending';
    return new;
  end if;
  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.blocked is distinct from old.blocked then
    raise exception 'only admins can change role or account status';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_user_privileges on users;
create trigger trg_protect_user_privileges
  before insert or update on users
  for each row execute function public.protect_user_privileges();


-- ═══════════════════════ MAKE ME ADMIN ═══════════════════════
-- 1) Register at https://www.banahub.com/register with your email first.
-- 2) Then remove the leading "-- " and run this line on its own:
-- update users set role = 'admin', status = 'approved' where email = 'ibthisam@banahub.com';
