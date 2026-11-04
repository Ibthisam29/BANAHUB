-- 24 · Member categories + member submissions (company raises, investor profiles & funds)

-- 1. member category (investor / company sub-type), editable by the member and admins
alter table public.users add column if not exists member_category text;
create index if not exists users_member_category on public.users (member_category);

-- 2. company raises submitted by members (stored as capital raises → visible in Fundraising Companies / Deal Pipeline)
alter table public.deal_rooms
  add column if not exists submitted_by       uuid references public.users(id) on delete set null,
  add column if not exists submitted_at       timestamptz,
  add column if not exists review_status      text check (review_status in ('submitted','in_review','needs_info','accepted','declined')),
  add column if not exists review_note        text,
  add column if not exists company_type       text,
  add column if not exists website            text,
  add column if not exists founded_year       int check (founded_year between 1900 and 2100),
  add column if not exists team_size          int check (team_size >= 0),
  add column if not exists next_stage         text,
  add column if not exists next_stage_amount  numeric check (next_stage_amount >= 0),
  add column if not exists next_stage_date    date;
create index if not exists deal_rooms_submitted_by on public.deal_rooms (submitted_by);
create index if not exists deal_rooms_review_status on public.deal_rooms (review_status) where submitted_by is not null;

drop policy if exists deal_rooms_member_own_read on public.deal_rooms;
create policy deal_rooms_member_own_read on public.deal_rooms for select to authenticated using (submitted_by = auth.uid());
drop policy if exists deal_rooms_member_own_insert on public.deal_rooms;
create policy deal_rooms_member_own_insert on public.deal_rooms for insert to authenticated with check (submitted_by = auth.uid());
drop policy if exists deal_rooms_member_own_update on public.deal_rooms;
create policy deal_rooms_member_own_update on public.deal_rooms for update to authenticated
  using (submitted_by = auth.uid() and review_status in ('submitted','needs_info')) with check (submitted_by = auth.uid());

create or replace function public.deal_rooms_member_guard() returns trigger
language plpgsql set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or public.is_admin() or public.os_can('raises.write') then return new; end if;
  -- a member: only their own submission fields; everything BANAHUB-internal is fixed
  new.submitted_by := auth.uid(); new.created_by := auth.uid(); new.published := false;
  if tg_op = 'INSERT' then
    select count(*) into n from deal_rooms where submitted_by = auth.uid() and created_at > now() - interval '30 days';
    if n >= 10 then raise exception 'Submission limit reached — contact BANAHUB'; end if;
    new.status := 'submitted'; new.pipeline_stage := 'new'; new.review_status := 'submitted'; new.review_note := null; new.submitted_at := now();
    new.os_owner_id := null; new.mandate_status := null; new.mandate_signed_at := null; new.probability := null; new.shortlist := null;
    new.os_company_id := null; new.os_opportunity_id := null; new.lost_reason := null; new.company_id := null;
    new.next_action := 'Review member submission'; new.next_action_date := current_date + 2;
  else
    new.status := old.status; new.pipeline_stage := old.pipeline_stage; new.review_note := old.review_note; new.submitted_at := old.submitted_at;
    new.review_status := case when old.review_status = 'needs_info' then 'submitted' else old.review_status end;
    new.os_owner_id := old.os_owner_id; new.mandate_status := old.mandate_status; new.mandate_signed_at := old.mandate_signed_at;
    new.probability := old.probability; new.shortlist := old.shortlist; new.os_company_id := old.os_company_id; new.os_opportunity_id := old.os_opportunity_id;
    new.lost_reason := old.lost_reason; new.company_id := old.company_id; new.next_action := old.next_action; new.next_action_date := old.next_action_date;
  end if;
  return new;
end $$;
revoke execute on function public.deal_rooms_member_guard() from public, anon, authenticated;
drop trigger if exists deal_rooms_member_guard on public.deal_rooms;
create trigger deal_rooms_member_guard before insert or update on public.deal_rooms for each row execute function public.deal_rooms_member_guard();

-- 3. investor profiles & funds submitted by members (investors table, one row per member)
alter table public.investors
  add column if not exists funds          jsonb not null default '[]',   -- [{name, size, currency, vintage, strategy, status, stages[], sectors[], geographies[], ticket_min, ticket_max}]
  add column if not exists aum            numeric check (aum >= 0),
  add column if not exists aum_currency   text,
  add column if not exists submitted_at   timestamptz,
  add column if not exists review_status  text check (review_status in ('submitted','in_review','needs_info','accepted','declined')),
  add column if not exists review_note    text;
create unique index if not exists investors_one_per_user on public.investors (user_id) where user_id is not null;

create or replace function public.investors_member_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or public.os_can('investors.write') then return new; end if;
  if jsonb_typeof(new.funds) <> 'array' or jsonb_array_length(new.funds) > 20 then raise exception 'Up to 20 funds'; end if;
  new.user_id := auth.uid();
  if tg_op = 'INSERT' then
    new.review_status := 'submitted'; new.review_note := null; new.submitted_at := now(); new.source := 'member_submission';
    new.relationship_strength := 0; new.relationship_owner := null; new.active := true;
  else
    new.review_note := old.review_note; new.submitted_at := coalesce(old.submitted_at, now()); new.source := old.source;
    new.review_status := case when old.review_status in ('needs_info') then 'submitted' else coalesce(old.review_status, 'submitted') end;
  end if;
  return new;
end $$;
revoke execute on function public.investors_member_guard() from public, anon, authenticated;
drop trigger if exists investors_member_guard on public.investors;
create trigger investors_member_guard before insert or update on public.investors for each row execute function public.investors_member_guard();

notify pgrst, 'reload schema';
