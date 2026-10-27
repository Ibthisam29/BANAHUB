-- 15 · Investor Matching Engine (requires 12 taxonomy + 14 Commercial OS core)
-- Investor mandate profile, raise fundraising attributes, deterministic MATCH SCORE /100,
-- one tracked record per company-raise × investor, human approval before any outreach,
-- no repeat sends. The system never sends email: outreach is recorded by a person.

-- ══════════════════════════════════════════════════════════════════
-- 0. PERMISSIONS + CLOSE PUBLIC INVESTOR READ
-- ══════════════════════════════════════════════════════════════════
insert into public.os_role_permissions (role, perm) values
  ('bd','matches.read'),('bd','matches.write'),('bd','investors.write')
on conflict do nothing;
-- outreach.approve stays CEO-only ('*') unless granted explicitly

-- investor records (with contact details) were readable by anyone when status = 'approved'
drop policy if exists investors_public_approved_read on public.investors;
drop policy if exists investors_os_read on public.investors;
create policy investors_os_read on public.investors for select to authenticated using (public.os_can('investors.read'));
drop policy if exists investors_os_write on public.investors;
create policy investors_os_write on public.investors for update to authenticated using (public.os_can('investors.write')) with check (public.os_can('investors.write'));
drop policy if exists deal_rooms_os_read on public.deal_rooms;
create policy deal_rooms_os_read on public.deal_rooms for select to authenticated using (public.os_can('matches.read'));

-- ══════════════════════════════════════════════════════════════════
-- 1. INVESTOR MANDATE PROFILE
-- ══════════════════════════════════════════════════════════════════
alter table public.investors
  add column if not exists sub_sectors           text[]  not null default '{}',
  add column if not exists invest_geographies    text[]  not null default '{}',   -- where they invest (geography = HQ)
  add column if not exists check_currency        text    not null default 'USD',
  add column if not exists instruments           text[]  not null default '{}',
  add column if not exists min_revenue           numeric,                           -- in check_currency, annual
  add column if not exists traction_requirement  text check (traction_requirement in ('none','pre_revenue','early_revenue','product_market_fit','scaling','profitable')),
  add column if not exists lead_follow           text check (lead_follow in ('lead','follow','either')),
  add column if not exists co_invest             text check (co_invest in ('yes','selective','no')),
  add column if not exists esg_preferences       text[]  not null default '{}',
  add column if not exists esg_exclusions        text[]  not null default '{}',     -- sectors they will not fund
  add column if not exists current_mandate       text,
  add column if not exists appetite              text check (appetite in ('active','selective','paused','not_deploying')),
  add column if not exists portfolio             text[]  not null default '{}',
  add column if not exists relationship_strength int     not null default 0 check (relationship_strength between 0 and 5),
  add column if not exists last_interaction_at   timestamptz,
  add column if not exists active                boolean not null default true,
  add column if not exists relationship_owner    uuid references public.users(id) on delete set null;

-- ══════════════════════════════════════════════════════════════════
-- 2. COMPANY FUNDRAISING ATTRIBUTES (capital raises = deal_rooms)
-- ══════════════════════════════════════════════════════════════════
alter table public.deal_rooms
  add column if not exists sub_sectors     text[]  not null default '{}',
  add column if not exists hq_country      text,
  add column if not exists instrument      text,
  add column if not exists annual_revenue  numeric,           -- in the raise currency
  add column if not exists revenue_growth_pct numeric,
  add column if not exists traction_stage  text check (traction_stage in ('none','pre_revenue','early_revenue','product_market_fit','scaling','profitable')),
  add column if not exists lead_needed     boolean not null default false,
  add column if not exists esg_profile     text[]  not null default '{}',
  add column if not exists use_of_funds    text,
  add column if not exists os_company_id   uuid references public.os_companies(id) on delete set null,
  add column if not exists os_opportunity_id uuid references public.os_opportunities(id) on delete set null;

-- ══════════════════════════════════════════════════════════════════
-- 3. HELPERS
-- ══════════════════════════════════════════════════════════════════
create or replace function public.os_stage_idx(s text) returns int language sql immutable as $$
  select case
    when s is null then null
    when lower(s) ~ 'pre.?seed' then 0
    when lower(s) ~ 'seed' then 1
    when lower(s) ~ 'series ?a' then 2
    when lower(s) ~ 'series ?b' then 3
    when lower(s) ~ 'series ?[c-z]|c\+' then 4
    when lower(s) ~ 'growth|expansion|late' then 5
    when lower(s) ~ 'pre.?ipo|mezz' then 6
    when lower(s) ~ 'buy.?out|control' then 7
    when lower(s) ~ 'debt|credit|loan' then 8
    else null end;
$$;
create or replace function public.os_traction_idx(s text) returns int language sql immutable as $$
  select case s when 'none' then 0 when 'pre_revenue' then 1 when 'early_revenue' then 2 when 'product_market_fit' then 3 when 'scaling' then 4 when 'profitable' then 5 end;
$$;
-- indicative FX to USD; used only to compare cheque sizes across currencies
create or replace function public.os_to_usd(amount numeric, cur text) returns numeric language sql immutable as $$
  select case when amount is null then null else amount * case upper(coalesce(cur, 'USD'))
    when 'USD' then 1 when 'SGD' then 0.74 when 'EUR' then 1.08 when 'GBP' then 1.27 when 'AED' then 0.272 when 'AUD' then 0.66
    when 'HKD' then 0.128 when 'JPY' then 0.0066 when 'MYR' then 0.22 when 'IDR' then 0.000063 when 'INR' then 0.012 else 1 end end;
$$;
-- country / region label → the set of labels it belongs to
create or replace function public.os_geo_set(t text) returns text[] language sql immutable as $$
  with x as (select lower(trim(coalesce(t, ''))) v)
  select case
    when v ~ 'global|worldwide|international|any' then array['global']
    when v ~ '^(sg|singapore)' or v ~ 'singapore' then array['singapore','southeast asia','asia pacific']
    when v ~ 'malaysia' then array['malaysia','southeast asia','asia pacific']
    when v ~ 'indonesia' then array['indonesia','southeast asia','asia pacific']
    when v ~ 'vietnam|viet nam' then array['vietnam','southeast asia','asia pacific']
    when v ~ 'thailand' then array['thailand','southeast asia','asia pacific']
    when v ~ 'philippines' then array['philippines','southeast asia','asia pacific']
    when v ~ 'south ?east asia|asean|\msea\M' then array['southeast asia','asia pacific']
    when v ~ 'uae|emirates|dubai|abu dhabi' then array['uae','middle east','gcc']
    when v ~ 'saudi|ksa|riyadh' then array['saudi arabia','middle east','gcc']
    when v ~ 'qatar|doha' then array['qatar','middle east','gcc']
    when v ~ 'gcc|gulf|middle east|mena' then array['middle east','gcc']
    when v ~ 'hong ?kong' then array['hong kong','north asia','asia pacific']
    when v ~ 'china|shanghai|beijing|shenzhen' then array['china','north asia','asia pacific']
    when v ~ 'japan|tokyo' then array['japan','north asia','asia pacific']
    when v ~ 'korea|seoul' then array['south korea','north asia','asia pacific']
    when v ~ 'north asia' then array['north asia','asia pacific']
    when v ~ 'india|mumbai|bangalore|bengaluru|delhi' then array['india','asia pacific']
    when v ~ 'australia|new zealand|sydney|melbourne|\mnz\M' then array['australia / nz','asia pacific']
    when v ~ 'asia' then array['asia pacific']
    when v ~ 'united kingdom|\muk\M|london|england|britain' then array['united kingdom','europe']
    when v ~ 'europe|france|germany|spain|italy|netherlands|sweden|norway|switzerland|austria|poland|ireland|denmark|finland|belgium|portugal' then array['europe']
    when v ~ 'united states|\musa?\M|america|california|new york|texas' then array['united states','north america']
    else array[v] end from x;
$$;

-- ══════════════════════════════════════════════════════════════════
-- 4. MATCH SCORE /100
-- ══════════════════════════════════════════════════════════════════
create or replace function public.os_match_breakdown(r public.deal_rooms, i public.investors) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  rs text[]; isec text[]; rind text[]; iind text[]; sector int := 0; stage int := 0; cheque int := 0; geo int := 0;
  instr int := 0; traction int := 0; mandate int := 0; rel int := 0; total int; band text;
  flags text[] := '{}'; why text[] := '{}'; unknown int := 0;
  r_stage int := os_stage_idx(r.stage); i_stages int[]; d int;
  lo numeric; hi numeric; imin numeric; imax numeric;
  rgeo text[] := '{}'; igeo text[] := '{}'; hq_only boolean := false; g text;
  rinstr text := lower(coalesce(r.instrument, r.investment_type, '')); iinstr text[];
  rev_ok int; trac_ok int; parts int := 0; acc numeric := 0;
  prior record;
begin
  -- Sector fit (20)
  select coalesce(array_agg(distinct canonical_sector(x)) filter (where canonical_sector(x) is not null), '{}') into rs from unnest(coalesce(r.sectors, '{}') || case when coalesce(r.industry,'') <> '' then string_to_array(r.industry, ',') else '{}' end) x;
  select coalesce(array_agg(distinct canonical_sector(x)) filter (where canonical_sector(x) is not null), '{}') into isec from unnest(coalesce(i.focus_sectors, '{}')) x;
  rind := sectors_to_industries(rs); iind := sectors_to_industries(isec);
  if exists (select 1 from unnest(coalesce(i.esg_exclusions, '{}')) e where canonical_sector(e) = any(rs) or e = any(rind)) then
    sector := 0; flags := flags || text 'ESG / sector exclusion';
  elsif cardinality(isec) = 0 then sector := 6; unknown := unknown + 1; why := why || text 'Sector focus not recorded';
  elsif rs && isec and not (isec = array['Generalist']) then
    sector := 20;
    if cardinality(r.sub_sectors) > 0 and cardinality(i.sub_sectors) > 0
       and not exists (select 1 from unnest(r.sub_sectors) a, unnest(i.sub_sectors) b where lower(a) = lower(b)) then sector := 16; end if;
    why := why || ('Sector: ' || array_to_string(array(select unnest(rs) intersect select unnest(isec)), ', '));
  elsif 'Generalist' = any(isec) then sector := 12; why := why || text 'Sector-agnostic investor';
  elsif rind && iind then sector := 12; why := why || ('Same industry: ' || array_to_string(array(select unnest(rind) intersect select unnest(iind)), ', '));
  else sector := 0; end if;

  -- Stage fit (15)
  select coalesce(array_agg(distinct os_stage_idx(x)) filter (where os_stage_idx(x) is not null), '{}') into i_stages from unnest(coalesce(i.preferred_stages, '{}')) x;
  if r_stage is null then stage := 7; unknown := unknown + 1;
  elsif cardinality(i_stages) = 0 then stage := 7; unknown := unknown + 1; why := why || text 'Stage preference not recorded';
  elsif r_stage = any(i_stages) then stage := 15; why := why || ('Stage: ' || r.stage);
  else
    select min(abs(s - r_stage)) into d from unnest(i_stages) s where s <> 8;
    stage := case when d = 1 then 8 else 0 end;
  end if;

  -- Cheque fit (15) — compared in USD
  hi := os_to_usd(r.target_raise, r.currency);
  lo := coalesce(os_to_usd(r.min_ticket, r.currency), hi * 0.05);
  imin := os_to_usd(i.check_min, i.check_currency); imax := os_to_usd(i.check_max, i.check_currency);
  if hi is null then cheque := 7; unknown := unknown + 1;
  elsif imin is null and imax is null then cheque := 7; unknown := unknown + 1; why := why || text 'Cheque size not recorded';
  elsif coalesce(imin, 0) <= hi and coalesce(imax, 'Infinity'::numeric) >= lo then cheque := 15; why := why || text 'Cheque size fits';
  elsif imax is not null and imax < lo and imax >= lo * 0.5 then cheque := 8;
  elsif imin is not null and imin > hi and imin <= hi * 2 then cheque := 5;
  else cheque := 0; end if;

  -- Geography fit (15)
  foreach g in array (string_to_array(coalesce(r.geography, ''), ',') || coalesce(r.hq_country, '')) loop
    if trim(g) <> '' then rgeo := rgeo || os_geo_set(g); end if;
  end loop;
  if cardinality(i.invest_geographies) > 0 then
    foreach g in array i.invest_geographies loop igeo := igeo || os_geo_set(g); end loop;
  elsif coalesce(i.geography, '') <> '' then
    hq_only := true;
    foreach g in array string_to_array(i.geography, ',') loop if trim(g) <> '' then igeo := igeo || os_geo_set(g); end if; end loop;
  end if;
  if cardinality(rgeo) = 0 then geo := 7; unknown := unknown + 1;
  elsif cardinality(igeo) = 0 then geo := 7; unknown := unknown + 1; why := why || text 'Investment geography not recorded';
  elsif 'global' = any(igeo) then geo := 12; why := why || text 'Global mandate';
  elsif rgeo[1] = any(igeo) or (rgeo && igeo and not hq_only) then geo := case when hq_only then 10 else 15 end;
    why := why || case when hq_only then 'Investor based in the same market' else 'Geography fits' end;
  elsif rgeo && igeo then geo := case when hq_only then 6 else 10 end;
  else geo := case when hq_only then 4 else 0 end; end if;

  -- Investment instrument fit (10)
  iinstr := array(select lower(x) from unnest(coalesce(i.instruments, '{}')) x);
  if rinstr = '' then instr := 5; unknown := unknown + 1;
  elsif cardinality(iinstr) = 0 then instr := 5; unknown := unknown + 1;
  elsif exists (select 1 from unnest(iinstr) x where x = rinstr or position(split_part(x, ' ', 1) in rinstr) > 0 or position(split_part(rinstr, ' ', 1) in x) > 0) then instr := 10; why := why || ('Instrument: ' || coalesce(r.instrument, r.investment_type));
  else instr := 0; end if;

  -- Traction fit (10)
  if i.min_revenue is not null then
    parts := parts + 1;
    if r.annual_revenue is null then acc := acc + 0.3; unknown := unknown + 1;
    elsif os_to_usd(r.annual_revenue, r.currency) >= os_to_usd(i.min_revenue, i.check_currency) then acc := acc + 1;
    elsif os_to_usd(r.annual_revenue, r.currency) >= os_to_usd(i.min_revenue, i.check_currency) * 0.5 then acc := acc + 0.4;
    else flags := flags || text 'Below revenue requirement'; end if;
  end if;
  if i.traction_requirement is not null and i.traction_requirement <> 'none' then
    parts := parts + 1;
    if r.traction_stage is null then acc := acc + 0.3;
    elsif os_traction_idx(r.traction_stage) >= os_traction_idx(i.traction_requirement) then acc := acc + 1;
    elsif os_traction_idx(r.traction_stage) = os_traction_idx(i.traction_requirement) - 1 then acc := acc + 0.4; end if;
  end if;
  if parts = 0 then traction := case when i.traction_requirement = 'none' then 10 else 7 end; if i.traction_requirement is null then unknown := unknown + 1; end if;
  else traction := round(10 * acc / parts); end if;
  if traction >= 9 and parts > 0 then why := why || text 'Meets traction requirements'; end if;

  -- Mandate / current appetite (10)
  if not i.active then mandate := 0; flags := flags || text 'Inactive investor';
  else
    mandate := case i.appetite when 'active' then 10 when 'selective' then 6 when 'paused' then 2 when 'not_deploying' then 0 else 5 end;
    if i.appetite is null then unknown := unknown + 1; end if;
    if i.appetite in ('paused','not_deploying') then flags := flags || text 'Not currently deploying'; end if;
    if r.lead_needed and i.lead_follow = 'follow' then mandate := greatest(0, mandate - 4); flags := flags || text 'Follow-only; raise needs a lead'; end if;
    if r.lead_needed and i.lead_follow in ('lead','either') then why := why || text 'Can lead'; end if;
  end if;
  -- the same company was declined by this investor in the last 12 months (any raise)
  select m.* into prior from os_investor_matches m
   where m.investor_id = i.id and m.raise_id <> r.id and m.status = 'declined' and m.responded_at > now() - interval '12 months'
     and m.company_key = coalesce(r.os_company_id::text, r.company_id::text, lower(coalesce(r.company_name, r.name)))
   order by m.responded_at desc limit 1;
  if found then mandate := greatest(0, mandate - 5); flags := flags || ('Declined this company ' || to_char(prior.responded_at, 'Mon YYYY') || coalesce(': ' || prior.decline_reason, '')); end if;

  -- BANAHUB relationship strength (5)
  rel := least(5, greatest(0, coalesce(i.relationship_strength, 0)));
  if rel >= 4 then why := why || text 'Strong BANAHUB relationship'; end if;

  total := sector + stage + cheque + geo + instr + traction + mandate + rel;
  if 'ESG / sector exclusion' = any(flags) or not i.active then total := least(total, 69); end if;
  band := case when total >= 90 then 'Exceptional match' when total >= 80 then 'Strong match' when total >= 70 then 'Possible match' else 'Do not recommend initially' end;
  if unknown >= 3 then flags := flags || text 'Incomplete investor profile — score is provisional'; end if;
  return jsonb_build_object('sector', sector, 'stage', stage, 'cheque', cheque, 'geography', geo, 'instrument', instr, 'traction', traction,
    'mandate', mandate, 'relationship', rel, 'total', total, 'band', band, 'flags', to_jsonb(flags), 'reasons', to_jsonb(why), 'unknowns', unknown, 'version', 1);
end $$;

-- ══════════════════════════════════════════════════════════════════
-- 5. EVERY RAISE × INVESTOR COMBINATION
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.os_investor_matches (
  id              uuid primary key default gen_random_uuid(),
  raise_id        uuid not null references public.deal_rooms(id) on delete cascade,
  investor_id     uuid not null references public.investors(id) on delete cascade,
  company_key     text not null,           -- same company across raises (prevents re-sending)
  score_total     int,
  breakdown       jsonb not null default '{}',
  band            text,
  flags           text[] not null default '{}',
  computed_at     timestamptz,
  status          text not null default 'suggested' check (status in
                    ('suggested','shortlisted','approved','contacted','interested','meeting','declined','no_response','invested','not_pursued','do_not_contact')),
  status_changed_at timestamptz not null default now(),
  owner_id        uuid references public.users(id) on delete set null,
  approved_by     uuid references public.users(id),
  approved_at     timestamptz,
  approval_note   text,
  allow_repeat    boolean not null default false,
  contacted_at    timestamptz,
  contacted_by    uuid references public.users(id),
  channel         text check (channel in ('email','linkedin','call','meeting','event','other')),
  responded_at    timestamptz,
  decline_reason  text check (decline_reason in ('sector','stage','cheque_size','geography','traction','valuation','team','timing','fund_capacity','conflict','no_reason','other')),
  decline_detail  text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (raise_id, investor_id)
);
create index if not exists os_matches_inv on public.os_investor_matches (investor_id, status);
create index if not exists os_matches_company on public.os_investor_matches (company_key, investor_id);
alter table public.os_investor_matches enable row level security;

create or replace function public.os_matches_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); inv record; dup record;
  sent_states text[] := array['contacted','interested','meeting','declined','no_response','invested'];
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
      new.contacted_at := now(); new.contacted_by := uid;
      update investors set last_interaction_at = now() where id = new.investor_id;
    elsif new.status in ('interested','meeting','declined','no_response','invested') then
      if old.contacted_at is null and new.status <> 'declined' then raise exception 'Record the outreach before recording a response'; end if;
      if new.status = 'declined' and new.decline_reason is null then raise exception 'Record a decline reason'; end if;
      new.responded_at := now();
      update investors set last_interaction_at = now() where id = new.investor_id;
    elsif new.status in ('suggested','shortlisted') and old.contacted_at is not null then
      raise exception 'Already sent — this combination cannot go back to suggested';
    end if;
  end if;
  if new.contacted_at is distinct from old.contacted_at and new.status = old.status then new.contacted_at := old.contacted_at; end if;
  return new;
end $$;
drop trigger if exists os_matches_guard on public.os_investor_matches;
create trigger os_matches_guard before insert or update on public.os_investor_matches for each row execute function public.os_matches_guard();

create or replace function public.os_matches_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into os_activity (entity_type, entity_id, kind, body, meta, actor_id)
    values ('match', new.id, 'change',
      'Status ' || old.status || ' → ' || new.status ||
      case when new.status = 'approved' and new.approval_note is not null then ' — ' || new.approval_note
           when new.status = 'contacted' then coalesce(' via ' || new.channel, '')
           when new.status = 'declined' then ' — ' || new.decline_reason || coalesce(': ' || new.decline_detail, '') else '' end,
      jsonb_build_object('raise_id', new.raise_id, 'investor_id', new.investor_id, 'score', new.score_total), auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists os_matches_log on public.os_investor_matches;
create trigger os_matches_log after update on public.os_investor_matches for each row execute function public.os_matches_log();

drop policy if exists os_matches_select on public.os_investor_matches;
create policy os_matches_select on public.os_investor_matches for select to authenticated using (public.os_can('matches.read'));
drop policy if exists os_matches_update on public.os_investor_matches;
create policy os_matches_update on public.os_investor_matches for update to authenticated using (public.os_can('matches.write')) with check (public.os_can('matches.write'));
drop policy if exists os_matches_delete on public.os_investor_matches;
create policy os_matches_delete on public.os_investor_matches for delete to authenticated using (public.os_role() = 'ceo_admin' and contacted_at is null);
-- inserts happen only through os_compute_matches()

-- history for matches visible to whoever can read matches
drop policy if exists os_activity_select on public.os_activity;
create policy os_activity_select on public.os_activity for select to authenticated using (
  public.os_role() = 'ceo_admin' or actor_id = auth.uid()
  or (entity_type = 'opportunity' and public.os_opp_visible_id(entity_id))
  or (entity_type = 'company' and public.os_company_visible(entity_id))
  or (entity_type in ('contact','task') and public.os_can('companies.read_all'))
  or (entity_type in ('match','investor') and public.os_can('matches.read')));

-- ══════════════════════════════════════════════════════════════════
-- 6. RUN THE ENGINE FOR A RAISE (scores only — never changes status)
-- ══════════════════════════════════════════════════════════════════
create or replace function public.os_compute_matches(p_raise uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r deal_rooms; i investors; b jsonb; n int := 0; ckey text;
begin
  if auth.uid() is not null and not public.os_can('matches.write') then raise exception 'Not permitted to run matching'; end if;
  select * into r from deal_rooms where id = p_raise;
  if not found then raise exception 'Raise not found'; end if;
  ckey := coalesce(r.os_company_id::text, r.company_id::text, lower(coalesce(r.company_name, r.name)));
  for i in select * from investors loop
    b := os_match_breakdown(r, i);
    insert into os_investor_matches (raise_id, investor_id, company_key, score_total, breakdown, band, flags, computed_at)
    values (r.id, i.id, ckey, (b->>'total')::int, b, b->>'band', array(select jsonb_array_elements_text(b->'flags')), now())
    on conflict (raise_id, investor_id) do update set score_total = excluded.score_total, breakdown = excluded.breakdown, band = excluded.band,
      flags = excluded.flags, computed_at = excluded.computed_at, company_key = excluded.company_key;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.os_compute_matches(uuid) from public;
grant execute on function public.os_compute_matches(uuid) to authenticated;

-- per-investor response history (for the investor profile)
create or replace view public.os_investor_history with (security_invoker = true) as
select investor_id,
  count(*) filter (where contacted_at is not null) as times_contacted,
  count(*) filter (where status in ('interested','meeting','invested')) as positive,
  count(*) filter (where status = 'declined') as declined,
  count(*) filter (where status = 'no_response') as no_response,
  count(*) filter (where status = 'invested') as invested,
  max(contacted_at) as last_contacted_at,
  array_remove(array_agg(distinct decline_reason), null) as decline_reasons
from public.os_investor_matches group by investor_id;
