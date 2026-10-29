-- 16 · Capital OS (requires 14 Commercial OS core + 15 Investor Matching)
-- Six screens: Capital Command Centre, Deal Pipeline, Investor CRM, Campaign Engine, Meeting Centre, Analytics.
--  • Deal pipeline stages on every capital raise, with owner / next action / probability / history
--  • Investor funnel per company × investor: contacted → opened → replied → interested → meeting → DD → term sheet → invested
--  • Campaigns: an approved investor cohort worked through an email / LinkedIn / introducer sequence with follow-ups.
--    Nothing is sent by the system: each touch is drafted, sent by a person, then recorded. Approval rules from 15 still apply.
--  • Meetings with brief, notes and a required next action once held

-- ══════════════════════════════════════════════════════════════════
-- 0. PERMISSIONS
-- ══════════════════════════════════════════════════════════════════
insert into public.os_role_permissions (role, perm) values ('bd','raises.write') on conflict do nothing;

-- ══════════════════════════════════════════════════════════════════
-- 1. DEAL PIPELINE (capital raises)
-- ══════════════════════════════════════════════════════════════════
alter table public.deal_rooms
  add column if not exists pipeline_stage   text not null default 'new',
  add column if not exists stage_changed_at timestamptz not null default now(),
  add column if not exists mandate_status   text not null default 'none',
  add column if not exists mandate_signed_at date,
  add column if not exists os_owner_id      uuid references public.users(id) on delete set null,
  add column if not exists next_action      text,
  add column if not exists next_action_date date,
  add column if not exists probability      int,
  add column if not exists lost_reason      text;
alter table public.deal_rooms drop constraint if exists deal_rooms_pipeline_stage_check;
alter table public.deal_rooms add constraint deal_rooms_pipeline_stage_check check (pipeline_stage in
  ('new','screening','ready','campaign','investor_interest','meeting','dd','negotiation','closed','on_hold','lost'));
alter table public.deal_rooms drop constraint if exists deal_rooms_mandate_status_check;
alter table public.deal_rooms add constraint deal_rooms_mandate_status_check check (mandate_status in ('none','proposed','signed','ended'));
alter table public.deal_rooms drop constraint if exists deal_rooms_probability_check;
alter table public.deal_rooms add constraint deal_rooms_probability_check check (probability is null or probability between 0 and 100);
create index if not exists deal_rooms_pipeline on public.deal_rooms (pipeline_stage);

-- ordered position of a pipeline stage (on_hold / lost sit outside the order)
create or replace function public.os_raise_stage_idx(s text) returns int language sql immutable as $$
  select array_position(array['new','screening','ready','campaign','investor_interest','meeting','dd','negotiation','closed'], s);
$$;

create or replace function public.os_raises_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.os_owner_id := coalesce(new.os_owner_id, case when public.os_can('raises.write') then auth.uid() end);
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  if tg_op = 'INSERT' or new.pipeline_stage is distinct from old.pipeline_stage then
    new.stage_changed_at := now();
    if new.pipeline_stage = 'lost' and coalesce(length(trim(new.lost_reason)), 0) < 3 then raise exception 'Record why this raise was lost'; end if;
    new.probability := coalesce(case when tg_op = 'UPDATE' and new.probability is distinct from old.probability then new.probability end,
      case new.pipeline_stage when 'new' then 5 when 'screening' then 10 when 'ready' then 20 when 'campaign' then 25 when 'investor_interest' then 35
        when 'meeting' then 45 when 'dd' then 60 when 'negotiation' then 75 when 'closed' then 100 when 'lost' then 0 else new.probability end);
    if new.pipeline_stage = 'closed' then new.status := 'closed'; end if;
  end if;
  if new.mandate_status = 'signed' and new.mandate_signed_at is null then new.mandate_signed_at := current_date; end if;
  return new;
end $$;
drop trigger if exists os_raises_before on public.deal_rooms;
create trigger os_raises_before before insert or update on public.deal_rooms for each row execute function public.os_raises_before();

create or replace function public.os_raises_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into os_activity (entity_type, entity_id, kind, body) values ('raise', new.id, 'change', 'Raise created — ' || new.pipeline_stage);
  else
    if new.pipeline_stage is distinct from old.pipeline_stage then
      insert into os_activity (entity_type, entity_id, kind, body) values ('raise', new.id, 'change',
        'Stage ' || old.pipeline_stage || ' → ' || new.pipeline_stage || case when new.pipeline_stage = 'lost' then ' — ' || new.lost_reason else '' end);
    end if;
    if new.mandate_status is distinct from old.mandate_status then
      insert into os_activity (entity_type, entity_id, kind, body) values ('raise', new.id, 'change', 'Mandate ' || old.mandate_status || ' → ' || new.mandate_status);
    end if;
    if new.next_action is distinct from old.next_action and new.next_action is not null then
      insert into os_activity (entity_type, entity_id, kind, body) values ('raise', new.id, 'change',
        'Next action: ' || new.next_action || coalesce(' (' || to_char(new.next_action_date, 'DD Mon') || ')', ''));
    end if;
    if new.raised_amount is distinct from old.raised_amount then
      insert into os_activity (entity_type, entity_id, kind, body) values ('raise', new.id, 'change',
        'Capital closed ' || coalesce(new.currency, 'USD') || ' ' || to_char(coalesce(new.raised_amount, 0), 'FM999,999,999,990'));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists os_raises_log on public.deal_rooms;
create trigger os_raises_log after insert or update on public.deal_rooms for each row execute function public.os_raises_log();

drop policy if exists deal_rooms_os_insert on public.deal_rooms;
create policy deal_rooms_os_insert on public.deal_rooms for insert to authenticated with check (public.os_can('raises.write'));
drop policy if exists deal_rooms_os_update on public.deal_rooms;
create policy deal_rooms_os_update on public.deal_rooms for update to authenticated using (public.os_can('raises.write')) with check (public.os_can('raises.write'));

-- ══════════════════════════════════════════════════════════════════
-- 2. INVESTOR FUNNEL ON EVERY COMPANY × INVESTOR RECORD
-- ══════════════════════════════════════════════════════════════════
alter table public.os_investor_matches
  add column if not exists campaign_id        uuid,
  add column if not exists opened_at          timestamptz,
  add column if not exists replied_at         timestamptz,
  add column if not exists interested_at      timestamptz,
  add column if not exists meeting_at         timestamptz,
  add column if not exists dd_at              timestamptz,
  add column if not exists term_sheet_at      timestamptz,
  add column if not exists invested_at        timestamptz,
  add column if not exists committed_amount   numeric,
  add column if not exists committed_currency text,
  add column if not exists introducer         text;
alter table public.os_investor_matches drop constraint if exists os_investor_matches_status_check;
alter table public.os_investor_matches add constraint os_investor_matches_status_check check (status in
  ('suggested','shortlisted','approved','contacted','interested','meeting','due_diligence','term_sheet','declined','no_response','invested','not_pursued','do_not_contact'));
alter table public.os_investor_matches drop constraint if exists os_investor_matches_channel_check;
alter table public.os_investor_matches add constraint os_investor_matches_channel_check check (channel in ('email','linkedin','introducer','call','meeting','event','other'));
create index if not exists os_matches_campaign on public.os_investor_matches (campaign_id);

-- 15's guard, extended with DD / term sheet / invested amount and funnel timestamps.
-- Reaching a later stage stamps any earlier stage that was skipped, so the funnel never inverts.
create or replace function public.os_matches_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); inv record; dup record; t timestamptz := now();
  sent_states text[] := array['contacted','interested','meeting','due_diligence','term_sheet','declined','no_response','invested'];
  ladder text[] := array['contacted','interested','meeting','due_diligence','term_sheet','invested'];
  lvl int;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.status <> 'suggested' and new.status <> 'shortlisted' then raise exception 'New matches start as suggested'; end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    if new.status = 'approved' then
      if uid is null then raise exception 'Outreach can only be approved by a signed-in person'; end if;
      if not public.os_can('outreach.approve') then raise exception 'Your role cannot approve investor outreach'; end if;
      if old.contacted_at is not null then raise exception 'This investor has already been sent this opportunity'; end if;
      select * into inv from investors where id = new.investor_id;
      if not inv.active then raise exception 'Investor is marked inactive'; end if;
      if coalesce(new.score_total, 0) < 70 and coalesce(length(trim(new.approval_note)), 0) < 10 then
        raise exception 'Score is below 70 — record why you are approving (at least 10 characters)'; end if;
      select m.* into dup from os_investor_matches m where m.investor_id = new.investor_id and m.company_key = new.company_key and m.id <> new.id
        and m.status = any(sent_states) order by m.contacted_at desc nulls last limit 1;
      if found and not (new.allow_repeat and coalesce(length(trim(new.approval_note)), 0) >= 10) then
        raise exception 'This company was already sent to this investor (% on %). Tick "allow repeat" and give a reason to approve again.', dup.status, coalesce(to_char(dup.contacted_at, 'DD Mon YYYY'), 'an earlier raise'); end if;
      new.approved_by := uid; new.approved_at := now();
    elsif new.status = 'contacted' then
      if old.status <> 'approved' or old.approved_by is null then raise exception 'Outreach needs human approval first'; end if;
      if old.contacted_at is not null then raise exception 'Already sent — the same opportunity cannot be sent twice'; end if;
      if uid is null then raise exception 'Outreach must be recorded by a signed-in person'; end if;
      new.contacted_at := t; new.contacted_by := uid;
      update investors set last_interaction_at = now() where id = new.investor_id;
    elsif new.status in ('interested','meeting','due_diligence','term_sheet','declined','no_response','invested') then
      if old.contacted_at is null and new.status <> 'declined' then raise exception 'Record the outreach before recording a response'; end if;
      if new.status = 'declined' and new.decline_reason is null then raise exception 'Record a decline reason'; end if;
      if new.status = 'invested' and coalesce(new.committed_amount, 0) <= 0 then raise exception 'Record the amount committed'; end if;
      new.responded_at := t;
      if new.status <> 'no_response' and old.contacted_at is not null then new.replied_at := coalesce(new.replied_at, t); end if;
      lvl := array_position(ladder, new.status);
      if lvl >= 2 then new.interested_at := coalesce(new.interested_at, t); end if;
      if lvl >= 3 then new.meeting_at    := coalesce(new.meeting_at, t); end if;
      if lvl >= 4 then new.dd_at         := coalesce(new.dd_at, t); end if;
      if lvl >= 5 then new.term_sheet_at := coalesce(new.term_sheet_at, t); end if;
      if lvl >= 6 then new.invested_at   := coalesce(new.invested_at, t); end if;
      update investors set last_interaction_at = now() where id = new.investor_id;
    elsif new.status in ('suggested','shortlisted') and old.contacted_at is not null then
      raise exception 'Already sent — this combination cannot go back to suggested';
    end if;
  end if;
  if new.contacted_at is distinct from old.contacted_at and new.status = old.status then new.contacted_at := old.contacted_at; end if;
  if new.replied_at is not null and new.contacted_at is null then raise exception 'Record the outreach before a reply'; end if;
  if new.opened_at is not null and new.contacted_at is null then new.opened_at := null; end if;
  if new.replied_at is not null then new.opened_at := coalesce(new.opened_at, new.replied_at); end if;
  if new.status = 'invested' then new.committed_currency := coalesce(new.committed_currency, (select currency from deal_rooms where id = new.raise_id), 'USD'); end if;
  return new;
end $$;

-- history line + move the raise forward through the pipeline + add closed capital
create or replace function public.os_matches_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare target text; r deal_rooms;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into os_activity (entity_type, entity_id, kind, body, meta, actor_id)
    values ('match', new.id, 'change',
      'Status ' || old.status || ' → ' || new.status ||
      case when new.status = 'approved' and new.approval_note is not null then ' — ' || new.approval_note
           when new.status = 'contacted' then coalesce(' via ' || new.channel, '')
           when new.status = 'declined' then ' — ' || new.decline_reason || coalesce(': ' || new.decline_detail, '')
           when new.status = 'invested' then ' — ' || coalesce(new.committed_currency, '') || ' ' || to_char(new.committed_amount, 'FM999,999,999,990') else '' end,
      jsonb_build_object('raise_id', new.raise_id, 'investor_id', new.investor_id, 'score', new.score_total), auth.uid());
    -- pipeline only ever moves forward automatically; closing stays a human decision
    target := case new.status when 'contacted' then 'campaign' when 'interested' then 'investor_interest' when 'meeting' then 'meeting'
                              when 'due_diligence' then 'dd' when 'term_sheet' then 'negotiation' when 'invested' then 'negotiation' end;
    select * into r from deal_rooms where id = new.raise_id;
    if target is not null and public.os_raise_stage_idx(r.pipeline_stage) is not null
       and public.os_raise_stage_idx(r.pipeline_stage) < public.os_raise_stage_idx(target) and r.pipeline_stage <> 'closed' then
      update deal_rooms set pipeline_stage = target where id = new.raise_id;
    end if;
    if new.status = 'invested' then
      update deal_rooms set raised_amount = coalesce(raised_amount, 0)
        + round(public.os_to_usd(new.committed_amount, new.committed_currency) / nullif(public.os_to_usd(1, coalesce(currency, 'USD')), 0))
        where id = new.raise_id;
    end if;
  end if;
  return new;
end $$;

-- ══════════════════════════════════════════════════════════════════
-- 3. CAMPAIGN ENGINE
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.os_campaigns (
  id            uuid primary key default gen_random_uuid(),
  raise_id      uuid not null references public.deal_rooms(id) on delete cascade,
  name          text not null,
  status        text not null default 'draft' check (status in ('draft','active','paused','completed')),
  -- [{ "day": 0, "channel": "email", "label": "Introduction" }, …] — follow-ups are the steps after the first
  sequence      jsonb not null default '[{"day":0,"channel":"email","label":"Introduction"},{"day":3,"channel":"linkedin","label":"LinkedIn connect"},{"day":7,"channel":"email","label":"Follow-up 1"},{"day":14,"channel":"introducer","label":"Introducer nudge"},{"day":21,"channel":"email","label":"Follow-up 2"}]',
  email_subject text,
  email_body    text,
  linkedin_body text,
  introducer    text,
  owner_id      uuid references public.users(id) on delete set null default auth.uid(),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.os_campaigns enable row level security;
alter table public.os_investor_matches drop constraint if exists os_investor_matches_campaign_fk;
alter table public.os_investor_matches add constraint os_investor_matches_campaign_fk foreign key (campaign_id) references public.os_campaigns(id) on delete set null;

-- every touch a person sent (or skipped) for a company × investor record
create table if not exists public.os_outreach (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.os_investor_matches(id) on delete cascade,
  campaign_id uuid references public.os_campaigns(id) on delete set null,
  step_no     int  not null default 0,
  channel     text not null check (channel in ('email','linkedin','introducer','call','meeting','event','other')),
  status      text not null default 'sent' check (status in ('sent','skipped')),
  introducer  text,
  subject     text,
  body        text,
  sent_at     timestamptz,
  opened_at   timestamptz,
  replied_at  timestamptz,
  reply_note  text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (match_id, campaign_id, step_no)
);
create index if not exists os_outreach_match on public.os_outreach (match_id, sent_at);
alter table public.os_outreach enable row level security;

create or replace function public.os_outreach_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare m os_investor_matches;
begin
  new.updated_at := now();
  select * into m from os_investor_matches where id = new.match_id;
  if tg_op = 'INSERT' then
    if auth.uid() is null then raise exception 'Outreach must be recorded by a signed-in person'; end if;
    new.created_by := auth.uid();
    if new.status = 'sent' then
      if m.approved_by is null then raise exception 'Outreach needs human approval first'; end if;
      if m.status in ('declined','do_not_contact','not_pursued','invested') then raise exception 'This investor is no longer in play for this raise (%)', m.status; end if;
      if new.channel = 'introducer' and coalesce(length(trim(new.introducer)), 0) < 2 then raise exception 'Name the introducer'; end if;
      new.sent_at := coalesce(new.sent_at, now());
    else
      new.sent_at := null;
    end if;
  else
    if new.opened_at is not null and new.sent_at is null then raise exception 'Only sent outreach can be opened'; end if;
    if new.replied_at is not null and new.sent_at is null then raise exception 'Only sent outreach can be replied to'; end if;
    if new.replied_at is not null then new.opened_at := coalesce(new.opened_at, new.replied_at); end if;
  end if;
  return new;
end $$;
drop trigger if exists os_outreach_before on public.os_outreach;
create trigger os_outreach_before before insert or update on public.os_outreach for each row execute function public.os_outreach_before();

-- the first sent touch IS the outreach on the match (goes through the approval guard); opens / replies roll up to the match
create or replace function public.os_outreach_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare m os_investor_matches;
begin
  select * into m from os_investor_matches where id = new.match_id;
  if tg_op = 'INSERT' and new.status = 'sent' then
    if m.status = 'approved' then
      update os_investor_matches set status = 'contacted', channel = new.channel,
        introducer = coalesce(new.introducer, introducer), campaign_id = coalesce(campaign_id, new.campaign_id) where id = m.id;
    else
      update investors set last_interaction_at = now() where id = m.investor_id;
    end if;
    insert into os_activity (entity_type, entity_id, kind, body, meta)
    values ('match', m.id, case when new.channel = 'email' then 'email' else 'note' end,
      case when new.step_no > 0 then 'Follow-up ' || new.step_no || ' sent via ' else 'Sent via ' end || new.channel || coalesce(' (introducer: ' || new.introducer || ')', ''),
      jsonb_build_object('outreach_id', new.id, 'campaign_id', new.campaign_id));
  elsif tg_op = 'INSERT' and new.status = 'skipped' then
    insert into os_activity (entity_type, entity_id, kind, body) values ('match', m.id, 'note', 'Step ' || new.step_no || ' (' || new.channel || ') skipped');
  elsif tg_op = 'UPDATE' then
    if new.opened_at is not null and old.opened_at is null then
      update os_investor_matches set opened_at = coalesce(opened_at, new.opened_at) where id = m.id;
    end if;
    if new.replied_at is not null and old.replied_at is null then
      update os_investor_matches set replied_at = coalesce(replied_at, new.replied_at) where id = m.id;
      update investors set last_interaction_at = now() where id = m.investor_id;
      insert into os_activity (entity_type, entity_id, kind, body) values ('match', m.id, 'email', 'Reply received' || coalesce(': ' || new.reply_note, ''));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists os_outreach_after on public.os_outreach;
create trigger os_outreach_after after insert or update on public.os_outreach for each row execute function public.os_outreach_after();

-- adding investors to a campaign cohort: only for this raise, never someone already ruled out
create or replace function public.os_matches_campaign_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare c os_campaigns;
begin
  if new.campaign_id is not null and new.campaign_id is distinct from old.campaign_id then
    select * into c from os_campaigns where id = new.campaign_id;
    if c.raise_id <> new.raise_id then raise exception 'Campaign belongs to a different raise'; end if;
    if new.status in ('declined','do_not_contact','not_pursued') then raise exception 'This investor is not in play for this raise'; end if;
  end if;
  return new;
end $$;
drop trigger if exists os_matches_campaign_check on public.os_investor_matches;
create trigger os_matches_campaign_check before update of campaign_id on public.os_investor_matches for each row execute function public.os_matches_campaign_check();

drop trigger if exists os_touch on public.os_campaigns;
create trigger os_touch before update on public.os_campaigns for each row execute function public.os_touch();

drop policy if exists os_campaigns_read on public.os_campaigns;
create policy os_campaigns_read on public.os_campaigns for select to authenticated using (public.os_can('matches.read'));
drop policy if exists os_campaigns_write on public.os_campaigns;
create policy os_campaigns_write on public.os_campaigns for all to authenticated using (public.os_can('matches.write')) with check (public.os_can('matches.write'));
drop policy if exists os_outreach_read on public.os_outreach;
create policy os_outreach_read on public.os_outreach for select to authenticated using (public.os_can('matches.read'));
drop policy if exists os_outreach_insert on public.os_outreach;
create policy os_outreach_insert on public.os_outreach for insert to authenticated with check (public.os_can('matches.write'));
drop policy if exists os_outreach_update on public.os_outreach;
create policy os_outreach_update on public.os_outreach for update to authenticated using (public.os_can('matches.write')) with check (public.os_can('matches.write'));
-- sent outreach is history: no deletes

-- ══════════════════════════════════════════════════════════════════
-- 4. MEETING CENTRE
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.os_meetings (
  id               uuid primary key default gen_random_uuid(),
  investor_id      uuid references public.investors(id) on delete set null,
  raise_id         uuid references public.deal_rooms(id) on delete set null,
  match_id         uuid references public.os_investor_matches(id) on delete set null,
  title            text,
  meeting_at       timestamptz not null,
  duration_min     int not null default 45,
  meeting_type     text not null default 'intro' check (meeting_type in ('intro','pitch','follow_up','dd','negotiation','other')),
  location         text,
  attendees        text,
  status           text not null default 'scheduled' check (status in ('scheduled','held','cancelled','no_show')),
  brief            text,
  notes            text,
  outcome          text check (outcome in ('positive','neutral','negative')),
  next_action      text,
  next_action_date date,
  owner_id         uuid references public.users(id) on delete set null default auth.uid(),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists os_meetings_at on public.os_meetings (meeting_at);
create index if not exists os_meetings_inv on public.os_meetings (investor_id);
alter table public.os_meetings enable row level security;

create or replace function public.os_meetings_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare m os_investor_matches;
begin
  new.updated_at := now();
  if new.match_id is not null then
    select * into m from os_investor_matches where id = new.match_id;
    new.investor_id := coalesce(new.investor_id, m.investor_id);
    new.raise_id := coalesce(new.raise_id, m.raise_id);
  elsif new.investor_id is not null and new.raise_id is not null then
    select id into new.match_id from os_investor_matches where investor_id = new.investor_id and raise_id = new.raise_id;
  end if;
  if new.investor_id is null then raise exception 'Choose the investor'; end if;
  if new.status = 'held' and (coalesce(length(trim(new.next_action)), 0) < 3 or new.next_action_date is null) then
    raise exception 'A held meeting needs a next action and a date';
  end if;
  return new;
end $$;
drop trigger if exists os_meetings_before on public.os_meetings;
create trigger os_meetings_before before insert or update on public.os_meetings for each row execute function public.os_meetings_before();

create or replace function public.os_meetings_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare m os_investor_matches;
begin
  if new.match_id is not null and new.status in ('scheduled','held') then
    select * into m from os_investor_matches where id = new.match_id;
    -- a meeting means interest: move the record forward (never backward, never without recorded outreach)
    if m.contacted_at is not null and m.status in ('contacted','interested','no_response') then
      update os_investor_matches set status = 'meeting' where id = m.id;
    end if;
    if m.contacted_at is not null and m.status not in ('declined','not_pursued','do_not_contact') then
      update os_investor_matches set meeting_at = coalesce(meeting_at, now()) where id = m.id; end if;
  end if;
  if new.status = 'held' and (tg_op = 'INSERT' or old.status <> 'held') and new.investor_id is not null then
    update investors set last_interaction_at = greatest(coalesce(last_interaction_at, new.meeting_at), new.meeting_at) where id = new.investor_id;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into os_activity (entity_type, entity_id, kind, body, meta) values ('meeting', new.id, 'meeting',
      'Meeting ' || new.status || ' — ' || to_char(new.meeting_at, 'DD Mon YYYY HH24:MI') || coalesce(' · next: ' || new.next_action, ''),
      jsonb_build_object('investor_id', new.investor_id, 'raise_id', new.raise_id, 'match_id', new.match_id));
    if new.match_id is not null then
      insert into os_activity (entity_type, entity_id, kind, body) values ('match', new.match_id, 'meeting',
        'Meeting ' || new.status || ' — ' || to_char(new.meeting_at, 'DD Mon YYYY'));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists os_meetings_after on public.os_meetings;
create trigger os_meetings_after after insert or update on public.os_meetings for each row execute function public.os_meetings_after();

drop policy if exists os_meetings_read on public.os_meetings;
create policy os_meetings_read on public.os_meetings for select to authenticated using (public.os_can('matches.read'));
drop policy if exists os_meetings_write on public.os_meetings;
create policy os_meetings_write on public.os_meetings for insert to authenticated with check (public.os_can('matches.write'));
drop policy if exists os_meetings_update on public.os_meetings;
create policy os_meetings_update on public.os_meetings for update to authenticated using (public.os_can('matches.write')) with check (public.os_can('matches.write'));
drop policy if exists os_meetings_delete on public.os_meetings;
create policy os_meetings_delete on public.os_meetings for delete to authenticated using (public.os_role() = 'ceo_admin');

-- ══════════════════════════════════════════════════════════════════
-- 5. ANALYTICS + HISTORY VISIBILITY
-- ══════════════════════════════════════════════════════════════════
-- one row per contacted company × investor, with every funnel stage it reached
create or replace view public.os_capital_funnel with (security_invoker = true) as
select m.id, m.raise_id, m.investor_id, m.campaign_id, m.channel, i.investor_type, m.status,
  m.contacted_at, m.opened_at, m.replied_at, m.interested_at, m.meeting_at, m.dd_at, m.term_sheet_at, m.invested_at,
  public.os_to_usd(m.committed_amount, m.committed_currency) as committed_usd, m.decline_reason
from public.os_investor_matches m join public.investors i on i.id = m.investor_id
where m.contacted_at is not null;

-- per-investor CRM summary (adds replies, meetings and capital to 15's history view)
create or replace view public.os_investor_history with (security_invoker = true) as
select m.investor_id,
  count(*) filter (where m.contacted_at is not null) as times_contacted,
  count(*) filter (where m.status in ('interested','meeting','due_diligence','term_sheet','invested')) as positive,
  count(*) filter (where m.status = 'declined') as declined,
  count(*) filter (where m.status = 'no_response') as no_response,
  count(*) filter (where m.status = 'invested') as invested,
  max(m.contacted_at) as last_contacted_at,
  array_remove(array_agg(distinct m.decline_reason), null) as decline_reasons,
  count(*) filter (where m.replied_at is not null) as replied,
  sum(public.os_to_usd(m.committed_amount, m.committed_currency)) filter (where m.status = 'invested') as invested_usd
from public.os_investor_matches m group by m.investor_id;

drop policy if exists os_activity_select on public.os_activity;
create policy os_activity_select on public.os_activity for select to authenticated using (
  public.os_role() = 'ceo_admin' or actor_id = auth.uid()
  or (entity_type = 'opportunity' and public.os_opp_visible_id(entity_id))
  or (entity_type = 'company' and public.os_company_visible(entity_id))
  or (entity_type in ('contact','task') and public.os_can('companies.read_all'))
  or (entity_type in ('match','investor','raise','meeting','campaign') and public.os_can('matches.read')));

-- existing raises start in the pipeline where their old status puts them
update public.deal_rooms set pipeline_stage = case when status = 'closed' then 'closed' when status = 'open' then 'ready' else 'new' end
where pipeline_stage = 'new' and status in ('open','closed');
