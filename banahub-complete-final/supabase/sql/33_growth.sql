-- 33 · Growth: lead capture, attribution (UTM / referral), readiness check results, growth settings
create table if not exists public.growth_events (
  id         uuid primary key default gen_random_uuid(),
  event      text not null check (event in ('landing','newsletter','readiness','signup','roundtable','founding')),
  email      text check (email is null or length(email) <= 320),
  name       text check (name is null or length(name) <= 160),
  company    text check (company is null or length(company) <= 200),
  role       text check (role is null or length(role) <= 60),
  score      int  check (score is null or score between 0 and 100),
  answers    jsonb,
  utm        jsonb,
  ref        text check (ref is null or length(ref) <= 40),
  referrer   text check (referrer is null or length(referrer) <= 500),
  page       text check (page is null or length(page) <= 300),
  status     text not null default 'new' check (status in ('new','contacted','converted','ignored')),
  created_at timestamptz not null default now()
);
create index if not exists growth_events_ev_idx on public.growth_events (event, created_at desc);
create index if not exists growth_events_email_idx on public.growth_events (lower(email));
alter table public.growth_events enable row level security;
drop policy if exists growth_events_admin on public.growth_events;
create policy growth_events_admin on public.growth_events for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- public capture: validated, size-limited, lightly throttled; no direct table access for anon
create or replace function public.growth_capture(p jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare ev text := p->>'event'; em text := lower(trim(coalesce(p->>'email', ''))); n int;
begin
  if ev not in ('landing','newsletter','readiness','signup','roundtable','founding') then return false; end if;
  if em <> '' and em !~ '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$' then return false; end if;
  if ev in ('newsletter','roundtable','founding') and em = '' then return false; end if;
  if pg_column_size(p) > 20000 then return false; end if;
  -- throttle: max 20 events per email per day; landings max 1 per ref+utm per minute
  if em <> '' then
    select count(*) into n from growth_events where lower(email) = em and created_at > now() - interval '1 day';
    if n >= 20 then return false; end if;
  else
    select count(*) into n from growth_events where event = ev and created_at > now() - interval '1 minute';
    if n >= 60 then return false; end if;
  end if;
  insert into growth_events (event, email, name, company, role, score, answers, utm, ref, referrer, page)
  values (ev, nullif(em, ''), left(nullif(trim(p->>'name'), ''), 160), left(nullif(trim(p->>'company'), ''), 200), left(nullif(p->>'role', ''), 60),
          case when (p->>'score') ~ '^\d{1,3}$' then least(100, (p->>'score')::int) end,
          case when jsonb_typeof(p->'answers') = 'object' then p->'answers' end,
          case when jsonb_typeof(p->'utm') = 'object' then p->'utm' end,
          left(nullif(regexp_replace(coalesce(p->>'ref', ''), '[^A-Za-z0-9_-]', '', 'g'), ''), 40),
          left(nullif(p->>'referrer', ''), 500), left(nullif(p->>'page', ''), 300));
  if ev = 'newsletter' or (ev in ('readiness','roundtable','founding') and (p->>'newsletter') = 'true') then
    insert into newsletter_subscribers (email, name, is_active) values (em, left(nullif(trim(p->>'name'), ''), 160), true)
    on conflict (email) do update set is_active = true;
  end if;
  return true;
end $$;
revoke execute on function public.growth_capture(jsonb) from public;
grant execute on function public.growth_capture(jsonb) to anon, authenticated;

-- public growth settings (banner / founding offer / roundtable), admin-editable
insert into public.site_settings (key, value) values ('growth', '{
  "banner_on": true,
  "banner_text": "Founding members: the first 50 companies and investors on FundMatch by BANAHUB join with founding-member benefits.",
  "banner_cta": "Check your investor readiness — free",
  "banner_link": "/readiness",
  "founding_cap": 50,
  "founding_terms": "Founding-member benefits are confirmed by the BANAHUB team when your membership is approved. Membership does not include investor introductions or financial advice.",
  "roundtable_on": true,
  "roundtable_text": "Invite-only founder–investor roundtable in Singapore. Request an invitation.",
  "newsletter_text": "Monthly ASEAN market & capital brief — market entry, funding activity and BANAHUB sessions. No spam; unsubscribe any time."
}') on conflict (key) do nothing;
notify pgrst, 'reload schema';
