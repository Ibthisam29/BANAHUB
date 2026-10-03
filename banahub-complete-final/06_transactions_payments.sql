-- 06_transactions_payments.sql
-- Ensures transactions table exists with all Stripe columns
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  type text not null,                     -- membership_monthly, membership_annual, contact_unlock, success_fee
  amount numeric default 0,
  currency text default 'SGD',
  stripe_session_id text,                 -- cs_... Stripe Checkout Session
  stripe_payment_intent_id text,          -- pi_... set by webhook on completion
  status text default 'pending',          -- pending | completed | failed | cancelled
  created_at timestamptz default now()
);

-- Add columns if table existed without them
alter table transactions add column if not exists stripe_session_id text;
alter table transactions add column if not exists stripe_payment_intent_id text;

-- RLS
alter table transactions enable row level security;

-- Users see their own; webhook uses service_role (bypasses RLS)
create policy if not exists "transactions_own_read" on transactions
  for select using (auth.uid() = user_id);

create policy if not exists "transactions_admin_all" on transactions
  for all using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

-- Efficient lookups by Stripe session ID (used by webhook)
create index if not exists idx_transactions_stripe_session on transactions(stripe_session_id);
create index if not exists idx_transactions_user_id on transactions(user_id);

-- Ensure subscriptions has stripe_subscription_id (already in base_schema but guard it)
alter table subscriptions add column if not exists stripe_subscription_id text;
create index if not exists idx_subscriptions_stripe_sub on subscriptions(stripe_subscription_id);

-- Helper RPC: payment-success.html polls this to get status without direct table access
create or replace function get_transaction_status(p_session_id text)
returns text
language sql security definer
as $$
  select status from transactions where stripe_session_id = p_session_id limit 1;
$$;
