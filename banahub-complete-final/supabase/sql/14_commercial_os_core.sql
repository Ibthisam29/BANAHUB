-- 14 · Commercial OS — Phase 1 core
-- Roles & least-privilege permissions, Companies, Contacts, Sales Opportunities,
-- Lead Qualification Score (human-approved, AI-suggest-only), Tasks, immutable history,
-- stalled / missing-next-action flags.

-- ══════════════════════════════════════════════════════════════════
-- 1. ROLES & PERMISSIONS
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.os_role_permissions (
  role text not null check (role in ('ceo_admin','bd','advisor','ai_marketing','finance','partner_agent')),
  perm text not null,
  primary key (role, perm)
);
create table if not exists public.os_staff (
  user_id    uuid primary key references public.users(id) on delete cascade,
  role       text not null check (role in ('ceo_admin','bd','advisor','ai_marketing','finance','partner_agent')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
alter table public.os_role_permissions enable row level security;
alter table public.os_staff enable row level security;

-- users.role = 'admin' is always CEO/Admin; everyone else needs an active os_staff row
create or replace function public.os_role() returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then 'ceo_admin'
              else (select s.role from os_staff s where s.user_id = auth.uid() and s.active) end;
$$;
create or replace function public.os_can(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from os_role_permissions r where r.role = public.os_role() and (r.perm = p or r.perm = '*'));
$$;
revoke all on function public.os_role() from public; grant execute on function public.os_role() to authenticated;
revoke all on function public.os_can(text) from public; grant execute on function public.os_can(text) to authenticated;

drop policy if exists "perms readable by staff" on public.os_role_permissions;
create policy "perms readable by staff" on public.os_role_permissions for select to authenticated using (public.os_role() is not null);
drop policy if exists "perms managed by ceo" on public.os_role_permissions;
create policy "perms managed by ceo" on public.os_role_permissions for all to authenticated using (public.os_can('settings.manage')) with check (public.os_can('settings.manage'));
drop policy if exists "staff readable" on public.os_staff;
create policy "staff readable" on public.os_staff for select to authenticated using (public.os_role() is not null);
drop policy if exists "staff managed by ceo" on public.os_staff;
create policy "staff managed by ceo" on public.os_staff for all to authenticated using (public.os_can('settings.manage')) with check (public.os_can('settings.manage'));

insert into public.os_role_permissions (role, perm) values
 ('ceo_admin','*'),
 -- Business Development: full pipeline, approves scores, no finance/settings, investor directory without sensitive fields
 ('bd','companies.read_all'),('bd','companies.write'),('bd','contacts.read_all'),('bd','contacts.write'),
 ('bd','opps.read_all'),('bd','opps.write'),('bd','opps.value'),('bd','scores.approve'),('bd','scores.override'),
 ('bd','tasks.read_all'),('bd','tasks.write'),('bd','investors.read'),('bd','ai.review'),
 -- Advisor: only opportunities they own or are on the team for
 ('advisor','opps.write'),('advisor','opps.value'),('advisor','tasks.write'),('advisor','ai.review'),
 -- AI / Marketing: campaigns, events, content; no pipeline values, no contact data
 ('ai_marketing','campaigns.write'),('ai_marketing','events.write'),('ai_marketing','content.write'),('ai_marketing','tasks.write'),('ai_marketing','ai.review'),
 -- Finance: read pipeline and values, contracts & invoices
 ('finance','companies.read_all'),('finance','opps.read_all'),('finance','opps.value'),('finance','finance.read'),('finance','finance.write'),('finance','tasks.write'),
 -- Partner / Agent: submit referrals and see only their own
 ('partner_agent','referrals.create'),('partner_agent','referrals.read'),('partner_agent','tasks.write')
on conflict do nothing;

-- ══════════════════════════════════════════════════════════════════
-- 2. CORE RECORDS (every record: owner, status, next action, date, history)
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.os_companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  website          text,
  country          text,
  sectors          text[] not null default '{}',
  industries       text[] not null default '{}',
  stage            text,
  revenue_band     text,
  relationship     text not null default 'prospect' check (relationship in ('prospect','client','former_client','partner','investor_org','other')),
  status           text not null default 'active' check (status in ('active','dormant','archived')),
  owner_id         uuid references public.users(id) on delete set null,
  next_action      text,
  next_action_date date,
  source           text,
  referred_by      uuid references public.users(id) on delete set null,
  member_company_id uuid references public.companies(id) on delete set null,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create table if not exists public.os_contacts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid references public.os_companies(id) on delete set null,
  full_name        text not null,
  title            text,
  email            text,
  phone            text,
  linkedin_url     text,
  is_decision_maker boolean not null default false,
  status           text not null default 'active' check (status in ('active','dormant','archived','do_not_contact')),
  owner_id         uuid references public.users(id) on delete set null,
  next_action      text,
  next_action_date date,
  source           text,
  referred_by      uuid references public.users(id) on delete set null,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create table if not exists public.os_opportunities (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  company_id        uuid references public.os_companies(id) on delete set null,
  contact_id        uuid references public.os_contacts(id) on delete set null,
  opp_type          text not null default 'advisory_mandate' check (opp_type in
                      ('advisory_mandate','market_entry','capital_readiness','partnership','portfolio_retainer','investor_introduction','success_fee')),
  stage             text not null default 'lead' check (stage in ('lead','qualified','discovery','proposal','negotiation','won','lost','on_hold','disqualified')),
  status            text generated always as (case when stage in ('won') then 'won' when stage in ('lost','disqualified') then 'closed'
                                                  when stage = 'on_hold' then 'on_hold' else 'open' end) stored,
  owner_id          uuid references public.users(id) on delete set null,
  team              uuid[] not null default '{}',
  next_action       text,
  next_action_date  date,
  value             numeric(14,2),
  currency          text not null default 'SGD',
  probability       int check (probability between 0 and 100),
  expected_close    date,
  fee_structure     text check (fee_structure in ('fixed','retainer','success_fee','fixed_plus_success','hourly','tbc')),
  score_total       int,
  score_class       text,
  score_id          uuid,
  source            text,
  enquiry_id        uuid references public.enquiries(id) on delete set null,
  referred_by       uuid references public.users(id) on delete set null,
  lost_reason       text,
  won_at            timestamptz,
  closed_at         timestamptz,
  last_activity_at  timestamptz not null default now(),
  notes             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create table if not exists public.os_tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  entity_type  text check (entity_type in ('opportunity','company','contact','investor','other')),
  entity_id    uuid,
  assignee_id  uuid references public.users(id) on delete set null,
  due_date     date,
  priority     text not null default 'normal' check (priority in ('high','normal','low')),
  status       text not null default 'open' check (status in ('open','done','cancelled')),
  completed_at timestamptz,
  notes        text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create table if not exists public.os_activity (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   uuid not null,
  kind        text not null default 'note' check (kind in ('note','call','email','meeting','change','score','system')),
  body        text,
  meta        jsonb not null default '{}',
  actor_id    uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists os_activity_entity on public.os_activity (entity_type, entity_id, created_at desc);
create index if not exists os_opps_stage on public.os_opportunities (stage);
create index if not exists os_opps_owner on public.os_opportunities (owner_id);
create index if not exists os_tasks_assignee on public.os_tasks (assignee_id, status, due_date);

-- ══════════════════════════════════════════════════════════════════
-- 3. LEAD QUALIFICATION SCORE (out of 100)
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.os_lead_scores (
  id                uuid primary key default gen_random_uuid(),
  opportunity_id    uuid not null references public.os_opportunities(id) on delete cascade,
  strategic_fit     int not null default 0 check (strategic_fit between 0 and 15),
  budget            int not null default 0 check (budget between 0 and 15),
  urgency           int not null default 0 check (urgency between 0 and 15),
  decision_maker    int not null default 0 check (decision_maker between 0 and 10),
  market_expansion  int not null default 0 check (market_expansion between 0 and 10),
  gtm_need          int not null default 0 check (gtm_need between 0 and 10),
  capital_readiness int not null default 0 check (capital_readiness between 0 and 10),
  commercial_potential int not null default 0 check (commercial_potential between 0 and 10),
  network_relevance int not null default 0 check (network_relevance between 0 and 5),
  total             int generated always as (strategic_fit + budget + urgency + decision_maker + market_expansion + gtm_need
                                             + capital_readiness + commercial_potential + network_relevance) stored,
  override_total    int check (override_total between 0 and 100),
  override_reason   text,
  final_total       int generated always as (coalesce(override_total, strategic_fit + budget + urgency + decision_maker + market_expansion
                                             + gtm_need + capital_readiness + commercial_potential + network_relevance)) stored,
  classification    text generated always as (case
                       when coalesce(override_total, strategic_fit + budget + urgency + decision_maker + market_expansion + gtm_need + capital_readiness + commercial_potential + network_relevance) >= 80 then 'Priority A'
                       when coalesce(override_total, strategic_fit + budget + urgency + decision_maker + market_expansion + gtm_need + capital_readiness + commercial_potential + network_relevance) >= 60 then 'Priority B'
                       when coalesce(override_total, strategic_fit + budget + urgency + decision_maker + market_expansion + gtm_need + capital_readiness + commercial_potential + network_relevance) >= 40 then 'Nurture'
                       else 'Disqualify / self-service' end) stored,
  source            text not null default 'human' check (source in ('human','ai','form_rules')),
  status            text not null default 'suggested' check (status in ('suggested','approved','rejected','superseded')),
  rationale         text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  approved_by       uuid references public.users(id),
  approved_at       timestamptz
);
create index if not exists os_scores_opp on public.os_lead_scores (opportunity_id, created_at desc);

create or replace function public.os_scores_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    -- scores are append-only: only status transitions (approve / reject / supersede) are allowed
    if (new.strategic_fit, new.budget, new.urgency, new.decision_maker, new.market_expansion, new.gtm_need, new.capital_readiness,
        new.commercial_potential, new.network_relevance, new.override_total, new.override_reason, new.source, new.opportunity_id)
       is distinct from
       (old.strategic_fit, old.budget, old.urgency, old.decision_maker, old.market_expansion, old.gtm_need, old.capital_readiness,
        old.commercial_potential, old.network_relevance, old.override_total, old.override_reason, old.source, old.opportunity_id) then
      raise exception 'Scores are immutable — create a new score instead';
    end if;
  end if;
  -- AI and form rules can only ever suggest
  if tg_op = 'INSERT' and new.source in ('ai','form_rules') then new.status := 'suggested'; new.approved_by := null; new.approved_at := null; end if;
  if new.override_total is not null then
    if coalesce(length(trim(new.override_reason)), 0) < 10 then raise exception 'A manual override needs a reason (at least 10 characters)'; end if;
    if uid is not null and not public.os_can('scores.override') then raise exception 'Not permitted to override scores'; end if;
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if uid is null then raise exception 'Scores can only be approved by a signed-in person'; end if;
    if not public.os_can('scores.approve') then raise exception 'Not permitted to approve scores'; end if;
    new.approved_by := uid; new.approved_at := now();
  end if;
  return new;
end $$;
drop trigger if exists os_scores_guard on public.os_lead_scores;
create trigger os_scores_guard before insert or update on public.os_lead_scores for each row execute function public.os_scores_guard();

-- On approval: supersede older approved scores, copy to the opportunity, log history
create or replace function public.os_scores_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    update os_lead_scores set status = 'superseded' where opportunity_id = new.opportunity_id and id <> new.id and status = 'approved';
    update os_opportunities set score_total = new.final_total, score_class = new.classification, score_id = new.id,
      stage = case when new.classification = 'Disqualify / self-service' and stage in ('lead','qualified') then 'disqualified'
                   when new.classification <> 'Disqualify / self-service' and stage = 'disqualified' then 'qualified' else stage end
      where id = new.opportunity_id;
    insert into os_activity (entity_type, entity_id, kind, body, meta, actor_id)
      values ('opportunity', new.opportunity_id, 'score',
              'Lead score approved: ' || new.final_total || '/100 (' || new.classification || ')' ||
              case when new.override_total is not null then ' — manual override from ' || new.total || ': ' || new.override_reason else '' end,
              jsonb_build_object('score_id', new.id, 'source', new.source), auth.uid());
  elsif tg_op = 'INSERT' and new.status = 'suggested' then
    insert into os_activity (entity_type, entity_id, kind, body, meta, actor_id)
      values ('opportunity', new.opportunity_id, 'score',
              'Score suggested by ' || case new.source when 'ai' then 'AI' when 'form_rules' then 'form rules' else 'team' end || ': ' || new.final_total || '/100 (' || new.classification || ') — awaiting approval',
              jsonb_build_object('score_id', new.id, 'source', new.source), auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists os_scores_apply on public.os_lead_scores;
create trigger os_scores_apply after insert or update on public.os_lead_scores for each row execute function public.os_scores_apply();

-- ══════════════════════════════════════════════════════════════════
-- 4. HISTORY + DEFAULTS
-- ══════════════════════════════════════════════════════════════════
create or replace function public.os_opps_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    if tg_op = 'INSERT' and new.probability is not null then null;
    else new.probability := case new.stage when 'lead' then 10 when 'qualified' then 20 when 'discovery' then 30 when 'proposal' then 50
                                when 'negotiation' then 70 when 'won' then 100 when 'lost' then 0 when 'disqualified' then 0 else coalesce(new.probability, 10) end;
    end if;
    if new.stage = 'won' then new.won_at := coalesce(new.won_at, now()); end if;
    if new.stage in ('won','lost','disqualified') then new.closed_at := coalesce(new.closed_at, now()); else new.closed_at := null; end if;
  end if;
  -- creator becomes owner only if they can work the pipeline (agents' referrals stay unassigned for the CEO/BD to pick up)
  if tg_op = 'INSERT' and new.owner_id is null and public.os_can('opps.write') then new.owner_id := auth.uid(); end if;
  if new.stage = 'lost' and coalesce(trim(new.lost_reason), '') = '' then raise exception 'A lost opportunity needs a reason'; end if;
  return new;
end $$;
drop trigger if exists os_opps_before on public.os_opportunities;
create trigger os_opps_before before insert or update on public.os_opportunities for each row execute function public.os_opps_before();

create or replace function public.os_log_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text; changes jsonb := '{}'; o jsonb; n jsonb;
  fields text[] := case tg_table_name
    when 'os_opportunities' then array['stage','owner_id','value','probability','next_action','next_action_date','expected_close','opp_type','fee_structure','lost_reason']
    when 'os_companies' then array['status','relationship','owner_id','next_action','next_action_date']
    when 'os_contacts' then array['status','owner_id','next_action','next_action_date','company_id']
    when 'os_tasks' then array['status','assignee_id','due_date'] end;
  et text := case tg_table_name when 'os_opportunities' then 'opportunity' when 'os_companies' then 'company' when 'os_contacts' then 'contact' else 'task' end;
begin
  if tg_op = 'INSERT' then
    insert into os_activity (entity_type, entity_id, kind, body, actor_id) values (et, new.id, 'system', 'Created', auth.uid());
    return new;
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  foreach k in array fields loop
    if o->k is distinct from n->k then changes := changes || jsonb_build_object(k, jsonb_build_array(o->k, n->k)); end if;
  end loop;
  if changes <> '{}' then
    insert into os_activity (entity_type, entity_id, kind, body, meta, actor_id)
      values (et, new.id, 'change', (select string_agg(initcap(replace(key, '_', ' ')), ', ') from jsonb_object_keys(changes) key) || ' changed', changes, auth.uid());
  end if;
  return new;
end $$;
create or replace function public.os_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_table_name = 'os_tasks' then
    if new.status = 'done' and old.status <> 'done' then new.completed_at := now(); elsif new.status <> 'done' then new.completed_at := null; end if;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['os_opportunities','os_companies','os_contacts','os_tasks'] loop
    execute format('drop trigger if exists os_log on %I', t);
    execute format('create trigger os_log after insert or update on %I for each row execute function public.os_log_changes()', t);
  end loop;
  foreach t in array array['os_companies','os_contacts','os_tasks'] loop
    execute format('drop trigger if exists os_touch on %I', t);
    execute format('create trigger os_touch before update on %I for each row execute function public.os_touch()', t);
  end loop;
end $$;

-- any activity on an opportunity refreshes last_activity_at (drives the "stale" flag)
create or replace function public.os_activity_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.entity_type = 'opportunity' then update os_opportunities set last_activity_at = now() where id = new.entity_id and last_activity_at < now() - interval '1 minute'; end if;
  return new;
end $$;
drop trigger if exists os_activity_touch on public.os_activity;
create trigger os_activity_touch after insert on public.os_activity for each row execute function public.os_activity_touch();

-- keep company industries in line with the taxonomy
create or replace function public.os_companies_industries() returns trigger language plpgsql set search_path = public as $$
begin new.industries := sectors_to_industries(new.sectors); return new; end $$;
drop trigger if exists os_companies_industries on public.os_companies;
create trigger os_companies_industries before insert or update of sectors on public.os_companies for each row execute function public.os_companies_industries();

-- ══════════════════════════════════════════════════════════════════
-- 5. ROW-LEVEL SECURITY (least privilege)
-- ══════════════════════════════════════════════════════════════════
alter table public.os_companies enable row level security;
alter table public.os_contacts enable row level security;
alter table public.os_opportunities enable row level security;
alter table public.os_tasks enable row level security;
alter table public.os_activity enable row level security;
alter table public.os_lead_scores enable row level security;

create or replace function public.os_opp_visible(p_owner uuid, p_team uuid[], p_ref uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.os_can('opps.read_all') or p_owner = auth.uid() or auth.uid() = any(coalesce(p_team, '{}'))
      or (public.os_can('referrals.read') and p_ref = auth.uid());
$$;
create or replace function public.os_opp_visible_id(oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from os_opportunities o where o.id = oid and public.os_opp_visible(o.owner_id, o.team, o.referred_by));
$$;
create or replace function public.os_company_visible(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.os_can('companies.read_all')
      or exists (select 1 from os_companies c where c.id = cid and (c.owner_id = auth.uid() or (public.os_can('referrals.read') and c.referred_by = auth.uid())))
      or exists (select 1 from os_opportunities o where o.company_id = cid and public.os_opp_visible(o.owner_id, o.team, o.referred_by));
$$;

drop policy if exists os_opps_select on public.os_opportunities;
create policy os_opps_select on public.os_opportunities for select to authenticated using (public.os_opp_visible(owner_id, team, referred_by));
drop policy if exists os_opps_insert on public.os_opportunities;
create policy os_opps_insert on public.os_opportunities for insert to authenticated with check (
  public.os_can('opps.read_all') and public.os_can('opps.write')
  or (public.os_can('opps.write') and owner_id = auth.uid())
  or (public.os_can('referrals.create') and referred_by = auth.uid() and stage = 'lead'));
drop policy if exists os_opps_update on public.os_opportunities;
create policy os_opps_update on public.os_opportunities for update to authenticated
  using (public.os_can('opps.write') and (public.os_can('opps.read_all') or owner_id = auth.uid() or auth.uid() = any(team)))
  with check (public.os_can('opps.write'));
drop policy if exists os_opps_delete on public.os_opportunities;
create policy os_opps_delete on public.os_opportunities for delete to authenticated using (public.os_role() = 'ceo_admin');

drop policy if exists os_companies_select on public.os_companies;
create policy os_companies_select on public.os_companies for select to authenticated using (public.os_company_visible(id));
drop policy if exists os_companies_write on public.os_companies;
create policy os_companies_write on public.os_companies for insert to authenticated with check (public.os_can('companies.write') or (public.os_can('referrals.create') and referred_by = auth.uid()) or public.os_can('opps.write'));
drop policy if exists os_companies_update on public.os_companies;
create policy os_companies_update on public.os_companies for update to authenticated using (public.os_can('companies.write') or owner_id = auth.uid()) with check (true);
drop policy if exists os_companies_delete on public.os_companies;
create policy os_companies_delete on public.os_companies for delete to authenticated using (public.os_role() = 'ceo_admin');

drop policy if exists os_contacts_select on public.os_contacts;
create policy os_contacts_select on public.os_contacts for select to authenticated using (
  public.os_can('contacts.read_all') or owner_id = auth.uid() or (public.os_can('referrals.read') and referred_by = auth.uid())
  or (company_id is not null and public.os_company_visible(company_id) and public.os_role() not in ('ai_marketing','finance')));
drop policy if exists os_contacts_write on public.os_contacts;
create policy os_contacts_write on public.os_contacts for insert to authenticated with check (public.os_can('contacts.write') or (public.os_can('referrals.create') and referred_by = auth.uid()) or public.os_can('opps.write'));
drop policy if exists os_contacts_update on public.os_contacts;
create policy os_contacts_update on public.os_contacts for update to authenticated using (public.os_can('contacts.write') or owner_id = auth.uid()) with check (true);
drop policy if exists os_contacts_delete on public.os_contacts;
create policy os_contacts_delete on public.os_contacts for delete to authenticated using (public.os_role() = 'ceo_admin');

drop policy if exists os_tasks_select on public.os_tasks;
create policy os_tasks_select on public.os_tasks for select to authenticated using (public.os_can('tasks.read_all') or assignee_id = auth.uid() or created_by = auth.uid());
drop policy if exists os_tasks_insert on public.os_tasks;
create policy os_tasks_insert on public.os_tasks for insert to authenticated with check (public.os_can('tasks.write') and (public.os_can('tasks.read_all') or assignee_id = auth.uid() or assignee_id is null));
drop policy if exists os_tasks_update on public.os_tasks;
create policy os_tasks_update on public.os_tasks for update to authenticated using (public.os_can('tasks.write') and (public.os_can('tasks.read_all') or assignee_id = auth.uid() or created_by = auth.uid())) with check (true);
drop policy if exists os_tasks_delete on public.os_tasks;
create policy os_tasks_delete on public.os_tasks for delete to authenticated using (public.os_can('tasks.read_all') or created_by = auth.uid());

drop policy if exists os_activity_select on public.os_activity;
create policy os_activity_select on public.os_activity for select to authenticated using (
  public.os_role() = 'ceo_admin' or actor_id = auth.uid()
  or (entity_type = 'opportunity' and public.os_opp_visible_id(entity_id))
  or (entity_type = 'company' and public.os_company_visible(entity_id))
  or (entity_type in ('contact','task') and public.os_can('companies.read_all')));
drop policy if exists os_activity_insert on public.os_activity;
create policy os_activity_insert on public.os_activity for insert to authenticated with check (public.os_role() is not null and actor_id = auth.uid() and kind in ('note','call','email','meeting'));
-- history is immutable: no update/delete policies

drop policy if exists os_scores_select on public.os_lead_scores;
create policy os_scores_select on public.os_lead_scores for select to authenticated using (public.os_opp_visible_id(opportunity_id));
drop policy if exists os_scores_insert on public.os_lead_scores;
create policy os_scores_insert on public.os_lead_scores for insert to authenticated with check (public.os_opp_visible_id(opportunity_id) and public.os_can('opps.write') and source in ('human','form_rules'));
drop policy if exists os_scores_update on public.os_lead_scores;
create policy os_scores_update on public.os_lead_scores for update to authenticated using (public.os_can('scores.approve')) with check (public.os_can('scores.approve'));

-- ══════════════════════════════════════════════════════════════════
-- 6. VIEWS: masked values + flags
-- ══════════════════════════════════════════════════════════════════
create or replace view public.os_opportunities_v with (security_invoker = true) as
select o.id, o.title, o.company_id, c.name as company_name, o.contact_id, ct.full_name as contact_name, o.opp_type, o.stage, o.status,
  o.owner_id, ow.full_name as owner_name, o.team, o.next_action, o.next_action_date,
  case when public.os_can('opps.value') then o.value end as value, o.currency,
  case when public.os_can('opps.value') then o.probability end as probability,
  case when public.os_can('opps.value') then round(coalesce(o.value, 0) * coalesce(o.probability, 0) / 100.0, 2) end as weighted_value,
  o.expected_close, o.fee_structure, o.score_total, o.score_class, o.score_id, o.source, o.enquiry_id, o.referred_by, o.lost_reason,
  o.won_at, o.closed_at, o.last_activity_at, o.notes, o.created_at, o.updated_at,
  (o.status = 'open' and (coalesce(trim(o.next_action), '') = '' or o.next_action_date is null)) as flag_no_next_action,
  (o.status = 'open' and o.next_action_date < current_date) as flag_overdue,
  (o.status = 'open' and o.owner_id is null) as flag_no_owner,
  (o.status = 'open' and o.last_activity_at < now() - interval '14 days') as flag_stale,
  (o.status = 'open' and (coalesce(trim(o.next_action), '') = '' or o.next_action_date is null or o.next_action_date < current_date
                          or o.owner_id is null or o.last_activity_at < now() - interval '14 days')) as stalled,
  exists (select 1 from os_lead_scores s where s.opportunity_id = o.id and s.status = 'suggested') as has_pending_score
from public.os_opportunities o
left join public.os_companies c on c.id = o.company_id
left join public.os_contacts ct on ct.id = o.contact_id
left join public.users ow on ow.id = o.owner_id;

-- ══════════════════════════════════════════════════════════════════
-- 7. MIGRATE THE OLD CRM (crm_contacts → companies / contacts / opportunities)
-- ══════════════════════════════════════════════════════════════════
do $$ declare r record; cid uuid; pid uuid; oid uuid; admin_id uuid; begin
  select id into admin_id from users where role = 'admin' order by created_at limit 1;
  for r in select * from crm_contacts where not exists (select 1 from os_contacts x where x.source = 'crm:' || crm_contacts.id) loop
    cid := null;
    if coalesce(trim(r.company), '') <> '' then
      select id into cid from os_companies where lower(name) = lower(trim(r.company)) limit 1;
      if cid is null then insert into os_companies (name, owner_id, source, created_by) values (trim(r.company), admin_id, 'crm:' || r.id, admin_id) returning id into cid; end if;
    end if;
    insert into os_contacts (company_id, full_name, title, email, phone, linkedin_url, owner_id, next_action, next_action_date, source, notes, created_by)
      values (cid, coalesce(nullif(trim(r.name), ''), r.email, 'Unknown'), r.title, r.email, r.phone, r.linkedin_url, admin_id, r.next_action, r.next_action_date, 'crm:' || r.id, r.notes, admin_id)
      returning id into pid;
    if coalesce(r.pipeline_stage, '') not in ('', 'archived') then
      insert into os_opportunities (title, company_id, contact_id, opp_type, stage, owner_id, next_action, next_action_date, value, currency, source, notes, created_by, lost_reason)
        values (coalesce(nullif(trim(r.company), ''), r.name) || ' — ' || coalesce(r.contact_type, 'advisory'), cid, pid,
                case when r.contact_type ilike '%investor%' then 'investor_introduction' when r.contact_type ilike '%partner%' then 'partnership' else 'advisory_mandate' end,
                case lower(r.pipeline_stage) when 'won' then 'won' when 'lost' then 'lost' when 'proposal' then 'proposal' when 'negotiation' then 'negotiation'
                     when 'qualified' then 'qualified' when 'contacted' then 'discovery' when 'meeting' then 'discovery' else 'lead' end,
                admin_id, r.next_action, r.next_action_date, r.deal_value, coalesce(r.currency, 'SGD'), 'crm:' || r.id, r.notes, admin_id,
                case when lower(r.pipeline_stage) = 'lost' then 'Migrated from old CRM' end)
        returning id into oid;
      insert into os_activity (entity_type, entity_id, kind, body, actor_id)
        select 'opportunity', oid, coalesce(nullif(a.kind, ''), 'note') , a.body, admin_id from crm_activities a
        where a.contact_id = r.id and coalesce(a.kind, 'note') in ('note','call','email','meeting');
    end if;
  end loop;
exception when others then raise notice 'CRM migration skipped: %', sqlerrm;
end $$;
