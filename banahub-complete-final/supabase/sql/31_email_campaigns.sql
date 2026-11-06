-- 31 · Email campaigns (fundraising campaigns, events, programmes, sponsorship / partnership invites, newsletters)
-- Admin-only tables. Sending happens in the `email-campaign` edge function via Resend.
-- Compliance (Singapore Spam Control Act / PDPA): unsubscribe link in every email, suppression list honoured on every send,
-- "<ADV>" subject label + sender identification for unsolicited recipients (imported investor contacts).

create table if not exists public.email_campaigns (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  kind             text not null default 'newsletter' check (kind in ('fundraising','event','programme','sponsorship','partnership','newsletter','other')),
  subject          text not null default '',
  preheader        text,
  body_html        text not null default '',
  from_name        text not null default 'BANAHUB',
  reply_to         text,
  audience         jsonb not null default '{}',   -- {sources:[...], member_categories:[...], investor_types:[...], crm_types:[...], manual:"a@b.com, ..."}
  status           text not null default 'draft' check (status in ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_at     timestamptz,
  started_at       timestamptz,
  sent_at          timestamptz,
  recipients_count int not null default 0,
  sent_count       int not null default 0,
  failed_count     int not null default 0,
  skipped_count    int not null default 0,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.email_sends (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.email_campaigns(id) on delete cascade,
  email        text not null,
  name         text,
  company      text,
  source       text,             -- members | investors | crm | subscribers | companies | manual
  unsolicited  boolean not null default false,
  status       text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  error        text,
  provider_id  text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (campaign_id, email)
);
create index if not exists email_sends_queue_idx on public.email_sends (status, created_at);

create table if not exists public.email_suppressions (
  email      text primary key,
  reason     text not null default 'unsubscribed' check (reason in ('unsubscribed','bounced','complaint','manual')),
  source     text,
  created_at timestamptz not null default now()
);

alter table public.email_campaigns    enable row level security;
alter table public.email_sends        enable row level security;
alter table public.email_suppressions enable row level security;
drop policy if exists email_campaigns_admin on public.email_campaigns;
drop policy if exists email_sends_admin_read on public.email_sends;
drop policy if exists email_suppr_admin on public.email_suppressions;
create policy email_campaigns_admin on public.email_campaigns for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy email_sends_admin_read on public.email_sends for select to authenticated using (public.is_admin());
create policy email_suppr_admin on public.email_suppressions for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- unsubscribe tokens: HMAC(email) with a private secret that only the database / service role can read
create table if not exists public.email_secret (id int primary key default 1 check (id = 1), secret text not null);
alter table public.email_secret enable row level security;   -- no policies: invisible to anon / authenticated
insert into public.email_secret (id, secret) values (1, encode(extensions.gen_random_bytes(32), 'hex')) on conflict (id) do nothing;

create or replace function public.email_unsub_token(p_email text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.hmac(lower(trim(p_email)), (select secret from email_secret where id = 1), 'sha256'), 'hex')
$$;
revoke execute on function public.email_unsub_token(text) from public, anon, authenticated;

-- public unsubscribe (link in every email): verifies the token, adds to suppression list
create or replace function public.email_unsubscribe(p_email text, p_token text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_email is null or p_token is null or length(p_email) > 320 then return false; end if;
  if public.email_unsub_token(p_email) <> p_token then return false; end if;
  insert into email_suppressions (email, reason, source) values (lower(trim(p_email)), 'unsubscribed', 'link')
  on conflict (email) do update set reason = 'unsubscribed';
  update newsletter_subscribers set is_active = false where lower(email) = lower(trim(p_email));
  return true;
end $$;
revoke execute on function public.email_unsubscribe(text, text) from public;
grant execute on function public.email_unsubscribe(text, text) to anon, authenticated;

insert into public.site_settings (key, value) values ('email', '{"daily_cap": 100, "monthly_cap": 3000, "from_email": "hello@banahub.com", "from_name": "BANAHUB", "reply_to": "ibthisam@banahub.com", "address": "Bana Private Limited (UEN 201933473Z), Singapore"}')
on conflict (key) do nothing;
notify pgrst, 'reload schema';
