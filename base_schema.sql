-- BANAHub — Base Schema for New Supabase Project
-- Reconstructed from actual usage in config.js (this project's own base
-- tables predate anything built in this conversation — I never saw their
-- original definitions, so types/constraints below are reasonable
-- inferences from how the app calls them, not a guaranteed exact match
-- to whatever existed before. Functionally sufficient to run the app.
--
-- Run this FIRST, on the new empty project, before security_hardening.sql
-- (which builds on top of these + adds everything from this conversation).

-- ══════════════════════════════════════════════════════════════════
-- USERS — mirrors auth.users, adds role/profile fields the app reads
-- ══════════════════════════════════════════════════════════════════
create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  company_name text,
  role text default 'applicant',   -- applicant, investor, founder, advisor, admin
  status text default 'pending',
  created_at timestamptz default now()
);
alter table users enable row level security;
create policy "users_own_read" on users for select using (auth.uid() = id);
create policy "users_own_update" on users for update using (auth.uid() = id);
create policy "users_admin_all" on users for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);
-- Note: this self-referencing admin check works because RLS policies on
-- the SAME table can reference it — Postgres evaluates this safely.

-- ══════════════════════════════════════════════════════════════════
-- APPLICATIONS — generic intake form (membership, business, etc.)
-- ══════════════════════════════════════════════════════════════════
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  type text default 'business',     -- business, investor, advisor, membership
  data jsonb default '{}',          -- raw form submission
  status text default 'pending',    -- pending, approved, rejected
  created_at timestamptz default now()
);
alter table applications enable row level security;
create policy "applications_own_read" on applications for select using (auth.uid() = user_id);
create policy "applications_own_insert" on applications for insert with check (auth.uid() = user_id);
create policy "applications_admin_all" on applications for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- COMPANIES — businesses seeking capital/partnership (also used by
-- the FundMatch matching system from earlier in this conversation)
-- ══════════════════════════════════════════════════════════════════
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  company_name text,
  logo_url text,
  industry text[],
  stage text,
  featured boolean default false,
  status text default 'pending',   -- pending, approved, rejected
  created_at timestamptz default now()
);
alter table companies enable row level security;
create policy "companies_public_approved_read" on companies for select using (status = 'approved');
create policy "companies_own_all" on companies for all using (auth.uid() = user_id);
create policy "companies_admin_all" on companies for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- INVESTORS
-- ══════════════════════════════════════════════════════════════════
create table if not exists investors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  investor_type text,
  focus_sectors text[],
  featured boolean default false,
  status text default 'pending',
  created_at timestamptz default now()
);
alter table investors enable row level security;
create policy "investors_public_approved_read" on investors for select using (status = 'approved');
create policy "investors_own_all" on investors for all using (auth.uid() = user_id);
create policy "investors_admin_all" on investors for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- ADVISORS
-- ══════════════════════════════════════════════════════════════════
create table if not exists advisors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  expertise text[],
  featured boolean default false,
  status text default 'pending',
  created_at timestamptz default now()
);
alter table advisors enable row level security;
create policy "advisors_public_approved_read" on advisors for select using (status = 'approved');
create policy "advisors_own_all" on advisors for all using (auth.uid() = user_id);
create policy "advisors_admin_all" on advisors for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- KYC UPLOADS
-- ══════════════════════════════════════════════════════════════════
create table if not exists kyc_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  document_type text,
  file_url text,
  status text default 'pending',   -- pending, verified, rejected
  created_at timestamptz default now()
);
alter table kyc_uploads enable row level security;
create policy "kyc_own_all" on kyc_uploads for all using (auth.uid() = user_id);
create policy "kyc_admin_all" on kyc_uploads for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- DEAL ROOMS — private collaboration spaces between matched parties
-- ══════════════════════════════════════════════════════════════════
create table if not exists deal_rooms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  created_by uuid references users(id),
  status text default 'draft',   -- draft, open, closed
  created_at timestamptz default now()
);
alter table deal_rooms enable row level security;

create table if not exists deal_room_members (
  id uuid primary key default gen_random_uuid(),
  deal_room_id uuid references deal_rooms(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  role text default 'member',    -- owner, member
  status text default 'invited', -- invited, accepted
  created_at timestamptz default now(),
  unique(deal_room_id, user_id)
);
alter table deal_room_members enable row level security;

create policy "deal_rooms_member_read" on deal_rooms for select using (
  exists (select 1 from deal_room_members m where m.deal_room_id = deal_rooms.id and m.user_id = auth.uid() and m.status = 'accepted')
);
create policy "deal_rooms_own_insert" on deal_rooms for insert with check (auth.uid() = created_by);
create policy "deal_rooms_admin_all" on deal_rooms for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);
create policy "deal_room_members_own_read" on deal_room_members for select using (auth.uid() = user_id);
create policy "deal_room_members_admin_all" on deal_room_members for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- INTRODUCTIONS — request an intro between two parties
-- ══════════════════════════════════════════════════════════════════
create table if not exists introductions (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references users(id),
  target_id uuid references users(id),
  message text,
  status text default 'pending',
  created_at timestamptz default now()
);
alter table introductions enable row level security;
create policy "introductions_participant_read" on introductions for select using (
  auth.uid() = requester_id or auth.uid() = target_id
);
create policy "introductions_own_insert" on introductions for insert with check (auth.uid() = requester_id);
create policy "introductions_admin_all" on introductions for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- MESSAGES — direct messages between users
-- ══════════════════════════════════════════════════════════════════
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references users(id),
  recipient_id uuid references users(id),
  body text,
  read boolean default false,
  created_at timestamptz default now()
);
alter table messages enable row level security;
create policy "messages_participant_read" on messages for select using (
  auth.uid() = sender_id or auth.uid() = recipient_id
);
create policy "messages_own_insert" on messages for insert with check (auth.uid() = sender_id);

-- ══════════════════════════════════════════════════════════════════
-- CRM CONTACTS — internal admin CRM/pipeline
-- ══════════════════════════════════════════════════════════════════
create table if not exists crm_contacts (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  contact_type text,
  pipeline_stage text default 'new',
  notes text,
  created_at timestamptz default now()
);
alter table crm_contacts enable row level security;
create policy "crm_contacts_admin_all" on crm_contacts for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- SUBSCRIPTIONS — recurring billing (separate from one-off transactions)
-- ══════════════════════════════════════════════════════════════════
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  plan text,
  status text default 'active',
  stripe_subscription_id text,
  created_at timestamptz default now()
);
alter table subscriptions enable row level security;
create policy "subscriptions_own_read" on subscriptions for select using (auth.uid() = user_id);
create policy "subscriptions_admin_all" on subscriptions for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- NEWSLETTER SUBSCRIBERS
-- ══════════════════════════════════════════════════════════════════
create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  is_active boolean default true,
  created_at timestamptz default now()
);
alter table newsletter_subscribers enable row level security;
create policy "newsletter_insert_anyone" on newsletter_subscribers for insert with check (true);
create policy "newsletter_admin_read" on newsletter_subscribers for select using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- ARTICLES — blog/CMS content
-- ══════════════════════════════════════════════════════════════════
create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  title text,
  slug text unique,
  body text,
  author_id uuid references users(id),
  published boolean default false,
  created_at timestamptz default now()
);
alter table articles enable row level security;
create policy "articles_public_read" on articles for select using (published = true);
create policy "articles_admin_all" on articles for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- MEDIA — uploaded file library (metadata; actual files in Storage)
-- ══════════════════════════════════════════════════════════════════
create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  file_url text not null,
  file_name text,
  file_type text,
  uploaded_by uuid references users(id),
  created_at timestamptz default now()
);
alter table media enable row level security;
create policy "media_admin_all" on media for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- PAGES — hero-section CMS content (slug + sections jsonb)
-- ══════════════════════════════════════════════════════════════════
create table if not exists pages (
  slug text primary key,
  sections jsonb default '{}',
  created_at timestamptz default now()
);
alter table pages enable row level security;
create policy "pages_public_read" on pages for select using (true);
create policy "pages_admin_write" on pages for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- EVENTS / PROGRAMS — base columns only (security_hardening.sql adds
-- price, luma, invite-only columns on top of these)
-- ══════════════════════════════════════════════════════════════════
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text,
  format text,
  event_date timestamptz,
  end_date timestamptz,
  location text,
  description text,
  capacity int,
  registration_url text,
  cover_image text,
  published boolean default false,
  featured boolean default false,
  created_by uuid references users(id),
  created_at timestamptz default now()
);
alter table events enable row level security;
create policy "events_public_read" on events for select using (published = true);
create policy "events_admin_all" on events for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

-- ══════════════════════════════════════════════════════════════════
-- Seed your own admin account (edit the email below, run AFTER you've
-- registered through /register.html on the live site with that email)
-- ══════════════════════════════════════════════════════════════════
-- update users set role = 'admin' where email = 'you@banahub.com';
