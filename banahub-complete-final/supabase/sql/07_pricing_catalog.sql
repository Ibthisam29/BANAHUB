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
