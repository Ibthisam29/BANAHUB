-- 27 · Investor member profile: firm contact, portfolio companies, key people / team (incl. fund managers)
-- Private to the investor, BANAHUB admins and permitted Admin OS staff (existing investors RLS). Never public.
alter table public.investors
  add column if not exists hq_country          text,
  add column if not exists firm_email          text,
  add column if not exists firm_phone          text,
  add column if not exists portfolio_companies jsonb not null default '[]',  -- [{name, sector, stage, year, website, status}]
  add column if not exists team                jsonb not null default '[]';  -- [{name, role, email, phone, linkedin, primary}]

create or replace function public.investors_member_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or public.os_can('investors.write') then return new; end if;
  if jsonb_typeof(new.funds) <> 'array' or jsonb_array_length(new.funds) > 20 then raise exception 'Up to 20 funds'; end if;
  if jsonb_typeof(new.portfolio_companies) <> 'array' or jsonb_array_length(new.portfolio_companies) > 200 then raise exception 'Up to 200 portfolio companies'; end if;
  if jsonb_typeof(new.team) <> 'array' or jsonb_array_length(new.team) > 30 then raise exception 'Up to 30 team members'; end if;
  if length(new.team::text) > 40000 or length(new.portfolio_companies::text) > 80000 then raise exception 'Profile is too large'; end if;
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
notify pgrst, 'reload schema';
