-- 18 · Membership billing (Stripe: card subscriptions + PayNow invoice subscriptions)
-- Plans and prices live here (editable in Admin OS) — never in frontend code.
-- Stripe IDs are external references only; internal UUIDs / codes are the keys.
-- All writes to memberships / payments / stripe_events come from the stripe-webhook and billing
-- Edge Functions (service role). Members can read only their own rows. Admin reads everything.

-- ══════════════════════════════════════════════════════════════════
-- 1. PLANS
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.membership_plans (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[a-z_]+$'),
  name                 text not null,
  tagline              text,
  benefits             text[] not null default '{}',
  monthly_price        numeric(10,2),            -- null = not sold monthly
  annual_price         numeric(10,2),            -- null = not sold annually
  currency             text not null default 'SGD',
  self_service         boolean not null default true,   -- false = application / approval only
  rank                 int not null default 0,          -- higher = more benefits (upgrade / downgrade)
  max_seats            int not null default 1,
  active               boolean not null default true,
  sort                 int not null default 0,
  stripe_product_id    text,
  stripe_price_monthly text,
  stripe_price_annual  text,
  stripe_price_monthly_amount numeric(10,2),    -- amount the stored Stripe price was created with
  stripe_price_annual_amount  numeric(10,2),
  updated_at           timestamptz not null default now()
);
alter table public.membership_plans enable row level security;
drop policy if exists plans_public_read on public.membership_plans;
create policy plans_public_read on public.membership_plans for select to anon, authenticated using (active);
drop policy if exists plans_admin_all on public.membership_plans;
create policy plans_admin_all on public.membership_plans for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.membership_plans (code, name, tagline, benefits, monthly_price, annual_price, self_service, rank, max_seats, sort) values
 ('free', 'BANAHUB Network', 'Stay close to the ASEAN growth conversation.',
  array['Newsletter and ASEAN insights','Public briefings','Selected invitations','Programme announcements','Selected resources'],
  0, 0, true, 0, 1, 1),
 ('growth', 'Growth Membership', 'For founders and leadership teams building GTM traction in Singapore and ASEAN.',
  array['Member portal','Monthly ASEAN Growth Briefing','Monthly founder / business roundtable','Monthly office hours','GTM and market-entry resources','Capital-readiness templates','Partner opportunity updates','Member pricing for events and programmes','Quarterly group capital-readiness session'],
  149, 1490, true, 1, 1, 2),
 ('scale', 'Scale Membership', 'Everything in Growth, plus senior advisory time for companies scaling across the region.',
  array['Everything in Growth','Quarterly advisory session','Quarterly Growth Diagnostic','Capital-readiness review','Market-entry briefings','Priority programme and roundtable consideration','Selected private CEO / C-suite sessions','Programme discounts','Up to 3 users from your organisation'],
  399, 3990, true, 2, 3, 3),
 ('investor_circle', 'Investor Circle', 'For VCs, PE, family offices, corporate venture and professional investors. By application.',
  array['Complimentary while in pilot','Opportunities screened against your stated mandate','Investor roundtables by invitation','Portfolio growth support in Singapore and ASEAN'],
  null, null, false, 0, 1, 4)
on conflict (code) do nothing;

-- ══════════════════════════════════════════════════════════════════
-- 2. MEMBERSHIPS (one row per member account)
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.memberships (
  user_id                uuid primary key references public.users(id) on delete cascade,
  plan_code              text not null default 'free' references public.membership_plans(code) on update cascade,
  status                 text not null default 'active' check (status in
                           ('active','pending_payment','past_due','canceled','expired','incomplete')),
  billing_period         text check (billing_period in ('monthly','annual')),
  payment_method         text check (payment_method in ('card','paynow')),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  access_until           timestamptz,           -- end of the last PAID period
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  churn_reason           text,
  payment_at_risk        boolean not null default false,
  started_at             timestamptz not null default now(),
  paid_since             timestamptz,           -- first paid period start (for new-MRR reporting)
  mrr                    numeric(10,2) not null default 0,  -- monthly-equivalent, SGD
  organisation           text,
  relationship_owner     uuid references public.users(id) on delete set null,
  next_action            text,
  next_action_date       date,
  engagement_score       int,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists memberships_status on public.memberships (plan_code, status);
alter table public.memberships enable row level security;
drop policy if exists memberships_own_read on public.memberships;
create policy memberships_own_read on public.memberships for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- admin may edit relationship fields; billing fields are overwritten by Stripe webhooks
drop policy if exists memberships_admin_update on public.memberships;
create policy memberships_admin_update on public.memberships for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- every signed-up account is at least on the free Network
insert into public.memberships (user_id, plan_code, status)
select id, 'free', 'active' from public.users on conflict (user_id) do nothing;
create or replace function public.memberships_on_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into memberships (user_id, plan_code, status) values (new.id, 'free', 'active') on conflict do nothing; return new; end $$;
drop trigger if exists memberships_on_user on public.users;
create trigger memberships_on_user after insert on public.users for each row execute function public.memberships_on_user();

-- the tier a member can actually use right now (server-side entitlement; grace: card 3 days for Stripe retries, PayNow 7 days to pay the renewal invoice)
create or replace function public.membership_effective_plan(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when m.plan_code in ('free','investor_circle') then m.plan_code
    when m.access_until is not null and m.access_until + case when m.payment_method = 'paynow' then interval '7 days' else interval '3 days' end > now() then m.plan_code
    else 'free' end
  from memberships m where m.user_id = uid;
$$;
grant execute on function public.membership_effective_plan(uuid) to authenticated;
create or replace function public.my_membership() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('plan_code', m.plan_code, 'effective_plan', public.membership_effective_plan(m.user_id), 'status', m.status,
    'billing_period', m.billing_period, 'payment_method', m.payment_method, 'current_period_end', m.current_period_end, 'access_until', m.access_until,
    'cancel_at_period_end', m.cancel_at_period_end, 'payment_at_risk', m.payment_at_risk, 'has_billing', m.stripe_customer_id is not null,
    'plan_name', p.name, 'benefits', p.benefits)
  from memberships m join membership_plans p on p.code = m.plan_code where m.user_id = auth.uid();
$$;
grant execute on function public.my_membership() to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 3. PAYMENTS + WEBHOOK IDEMPOTENCY
-- ══════════════════════════════════════════════════════════════════
alter table public.transactions
  add column if not exists stripe_invoice_id      text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_charge_id       text,
  add column if not exists plan_code              text,
  add column if not exists billing_period         text,
  add column if not exists payment_method         text,
  add column if not exists period_start           timestamptz,
  add column if not exists period_end             timestamptz,
  add column if not exists amount_refunded        numeric(12,2) not null default 0,
  add column if not exists revenue_source         text,      -- membership | event | programme | sponsorship | advisory
  add column if not exists paid_at                timestamptz,
  add column if not exists description            text;
create unique index if not exists transactions_invoice_uq on public.transactions (stripe_invoice_id) where stripe_invoice_id is not null;

create table if not exists public.stripe_events (
  id           text primary key,              -- Stripe event id (evt_…)
  type         text not null,
  livemode     boolean,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);
alter table public.stripe_events enable row level security;
drop policy if exists stripe_events_admin on public.stripe_events;
create policy stripe_events_admin on public.stripe_events for select to authenticated using (public.is_admin());

-- ══════════════════════════════════════════════════════════════════
-- 4. REVENUE VIEWS (admin)
-- ══════════════════════════════════════════════════════════════════
create or replace view public.revenue_membership_summary with (security_invoker = true) as
select
  coalesce(sum(m.mrr) filter (where public.membership_effective_plan(m.user_id) in ('growth','scale')), 0) as mrr,
  coalesce(sum(m.mrr) filter (where public.membership_effective_plan(m.user_id) in ('growth','scale')), 0) * 12 as arr,
  count(*) filter (where public.membership_effective_plan(m.user_id) in ('growth','scale')) as paid_members,
  count(*) filter (where public.membership_effective_plan(m.user_id) = 'growth') as growth_members,
  count(*) filter (where public.membership_effective_plan(m.user_id) = 'scale') as scale_members,
  count(*) filter (where m.plan_code = 'free' or public.membership_effective_plan(m.user_id) = 'free') as free_members,
  count(*) filter (where m.plan_code = 'investor_circle') as investor_circle,
  count(*) filter (where m.payment_at_risk) as at_risk,
  count(*) filter (where m.paid_since >= date_trunc('month', now())) as new_paid_mtd,
  coalesce(sum(m.mrr) filter (where m.paid_since >= date_trunc('month', now())), 0) as new_mrr_mtd,
  count(*) filter (where m.canceled_at >= date_trunc('month', now())) as churned_mtd,
  coalesce(sum(m.mrr) filter (where m.canceled_at >= date_trunc('month', now())), 0) as churned_mrr_mtd,
  count(*) filter (where m.plan_code in ('growth','scale') and not m.cancel_at_period_end and m.current_period_end between now() and now() + interval '30 days') as renewals_30d
from public.memberships m;

create or replace view public.revenue_by_source with (security_invoker = true) as
select coalesce(revenue_source, item_type, type, 'other') as source, date_trunc('month', coalesce(paid_at, created_at)) as month,
  sum(amount - amount_refunded) as net_amount, currency, count(*) as payments
from public.transactions where status in ('completed','paid','partially_refunded')
group by 1, 2, currency;

-- admin can read all transactions (writes only from service role)
drop policy if exists transactions_admin_read on public.transactions;
create policy transactions_admin_read on public.transactions for select to authenticated using (public.is_admin() or user_id = auth.uid());
