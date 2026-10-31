-- 19 · Billing admin: Stripe invoice mirror, sync state, admin action log
-- Written only by the stripe-webhook and billing-admin Edge Functions (service role). Admin reads; members read their own invoices.

create table if not exists public.stripe_invoices (
  id                 text primary key,              -- Stripe invoice id (in_…)
  number             text,
  user_id            uuid references public.users(id) on delete set null,
  stripe_customer_id text,
  customer_email     text,
  customer_name      text,
  stripe_subscription_id text,
  status             text,                          -- draft | open | paid | void | uncollectible
  collection_method  text,                          -- charge_automatically | send_invoice
  billing_reason     text,
  currency           text not null default 'SGD',
  subtotal           numeric(12,2) not null default 0,
  total              numeric(12,2) not null default 0,
  amount_paid        numeric(12,2) not null default 0,
  amount_due         numeric(12,2) not null default 0,
  amount_remaining   numeric(12,2) not null default 0,
  amount_refunded    numeric(12,2) not null default 0,
  description        text,
  revenue_source     text,                          -- membership | event | programme | sponsorship | advisory | other
  plan_code          text,
  lines              jsonb not null default '[]',
  payment_method     text,
  stripe_charge_id   text,
  stripe_payment_intent_id text,
  paid_out_of_band   boolean not null default false,
  hosted_invoice_url text,
  invoice_pdf        text,
  due_date           timestamptz,
  period_start       timestamptz,
  period_end         timestamptz,
  created_at         timestamptz,
  finalized_at       timestamptz,
  paid_at            timestamptz,
  voided_at          timestamptz,
  livemode           boolean,
  created_by         uuid references public.users(id) on delete set null,
  synced_at          timestamptz not null default now()
);
create index if not exists stripe_invoices_status on public.stripe_invoices (status, due_date);
create index if not exists stripe_invoices_customer on public.stripe_invoices (stripe_customer_id);
create index if not exists stripe_invoices_user on public.stripe_invoices (user_id);
alter table public.stripe_invoices enable row level security;
drop policy if exists stripe_invoices_read on public.stripe_invoices;
create policy stripe_invoices_read on public.stripe_invoices for select to authenticated using (public.is_admin() or user_id = auth.uid());

create table if not exists public.billing_admin_log (
  id         bigserial primary key,
  admin_id   uuid references public.users(id) on delete set null,
  action     text not null,
  target     text,
  detail     jsonb,
  ok         boolean not null default true,
  error      text,
  created_at timestamptz not null default now()
);
alter table public.billing_admin_log enable row level security;
drop policy if exists billing_admin_log_read on public.billing_admin_log;
create policy billing_admin_log_read on public.billing_admin_log for select to authenticated using (public.is_admin());

create table if not exists public.stripe_sync_state (
  id          int primary key default 1 check (id = 1),
  last_run_at timestamptz,
  last_ok     boolean,
  summary     jsonb,
  livemode    boolean,
  account     text
);
insert into public.stripe_sync_state (id) values (1) on conflict do nothing;
alter table public.stripe_sync_state enable row level security;
drop policy if exists stripe_sync_state_read on public.stripe_sync_state;
create policy stripe_sync_state_read on public.stripe_sync_state for select to authenticated using (public.is_admin());

-- receivables summary for the Admin OS
create or replace view public.revenue_receivables with (security_invoker = true) as
select
  count(*) filter (where status = 'open') as open_count,
  coalesce(sum(amount_remaining) filter (where status = 'open'), 0) as open_amount,
  count(*) filter (where status = 'open' and due_date < now()) as overdue_count,
  coalesce(sum(amount_remaining) filter (where status = 'open' and due_date < now()), 0) as overdue_amount,
  count(*) filter (where status = 'paid' and paid_at >= date_trunc('month', now())) as paid_mtd_count,
  coalesce(sum(amount_paid - amount_refunded) filter (where status = 'paid' and paid_at >= date_trunc('month', now())), 0) as paid_mtd_amount,
  count(*) filter (where status = 'draft') as draft_count
from public.stripe_invoices;
