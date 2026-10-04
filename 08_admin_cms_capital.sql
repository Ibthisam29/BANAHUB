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
