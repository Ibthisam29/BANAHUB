-- 22 · Industry partners
-- partners       = public profile (shown on the website when published) + categorisation
-- partner_crm    = private relationship record (contacts, status, agreement, referrals) — staff only

alter table public.partners
  add column if not exists category    text,                         -- law_firm | accounting | bank | government | accelerator | corporate | service_provider | media | university | association | investor_network | other
  add column if not exists sectors     text[] not null default '{}', -- industry_taxonomy sectors they serve / operate in
  add column if not exists industries  text[] not null default '{}', -- derived
  add column if not exists countries   text[] not null default '{}',
  add column if not exists services    text[] not null default '{}',
  add column if not exists updated_at  timestamptz not null default now();
create index if not exists partners_industries_gin on public.partners using gin (industries);

create or replace function public.partners_set_industries() returns trigger
language plpgsql set search_path = public as $$
begin new.industries := sectors_to_industries(new.sectors); new.updated_at := now(); return new; end $$;
revoke execute on function public.partners_set_industries() from public, anon, authenticated;
drop trigger if exists partners_industries on public.partners;
create trigger partners_industries before insert or update on public.partners for each row execute function public.partners_set_industries();

-- staff (Commercial OS) can manage partners too, not only the admin account
drop policy if exists partners_os_read on public.partners;
create policy partners_os_read on public.partners for select to authenticated using (public.os_can('companies.read_all'));
drop policy if exists partners_os_write on public.partners;
create policy partners_os_write on public.partners for all to authenticated using (public.os_can('companies.write')) with check (public.os_can('companies.write'));

create table if not exists public.partner_crm (
  partner_id        uuid primary key references public.partners(id) on delete cascade,
  status            text not null default 'prospect' check (status in ('prospect','in_discussion','active','paused','ended')),
  agreement_type    text check (agreement_type in ('none','mou','referral','revenue_share','sponsorship','service_agreement','co_delivery','other')),
  agreement_start   date,
  agreement_end     date,
  referral_fee_pct  numeric(5,2) check (referral_fee_pct between 0 and 100),
  contact_name      text,
  contact_title     text,
  contact_email     text,
  contact_phone     text,
  owner_id          uuid references public.users(id) on delete set null,
  next_action       text,
  next_action_date  date,
  last_contact_at   date,
  referrals_in      int not null default 0 check (referrals_in >= 0),
  referrals_out     int not null default 0 check (referrals_out >= 0),
  value_generated   numeric(14,2),
  currency          text not null default 'SGD',
  notes             text,
  updated_at        timestamptz not null default now(),
  updated_by        uuid default auth.uid()
);
create index if not exists partner_crm_status on public.partner_crm (status, next_action_date);
alter table public.partner_crm enable row level security;
revoke all on public.partner_crm from anon;
drop policy if exists partner_crm_read on public.partner_crm;
create policy partner_crm_read on public.partner_crm for select to authenticated using (public.is_admin() or public.os_can('companies.read_all'));
drop policy if exists partner_crm_write on public.partner_crm;
create policy partner_crm_write on public.partner_crm for all to authenticated using (public.is_admin() or public.os_can('companies.write')) with check (public.is_admin() or public.os_can('companies.write'));
