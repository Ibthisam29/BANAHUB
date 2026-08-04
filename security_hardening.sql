-- BANAHub — Security hardening
-- Run in Supabase SQL Editor (project: ositmmczozefrdzcgxrp)

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

create policy "transactions_owner_read" on transactions
  for select using (auth.uid() = user_id);

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

create policy "site_settings_public_read" on site_settings
  for select using (true);  -- general/branding/seo drive the public site's own rendering

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
create policy "partners_public_read" on partners for select using (published = true);
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
create policy "access_requests_own_read" on access_requests for select using (auth.uid() = requester_id);
create policy "access_requests_own_insert" on access_requests for insert with check (auth.uid() = requester_id);
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
create policy "enquiries_insert_anyone" on enquiries for insert with check (true);
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
create policy "activity_logs_insert_authenticated" on activity_logs for insert with check (auth.role() = 'authenticated');
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

create policy "event_rsvps_admin_all" on event_rsvps
  for all using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

create policy "programs_public_read" on programs
  for select using (published = true);

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
create policy "login_attempts_insert_anyone" on login_attempts
  for insert with check (true);

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
      url := 'https://ositmmczozefrdzcgxrp.supabase.co/functions/v1/notify-admin-login-attempt',
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

create trigger trg_notify_admin_login
  after insert on login_attempts
  for each row execute function notify_admin_on_login_attempt();
