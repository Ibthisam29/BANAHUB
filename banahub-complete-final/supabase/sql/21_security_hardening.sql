-- 21 · Security hardening (audit 2026-11-03)

-- 1. Trigger functions must never be callable through the API (/rest/v1/rpc/...)
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype) loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- 2. Matching engine: signed-in staff only (anonymous callers previously skipped the permission check)
revoke execute on function public.os_compute_matches(uuid) from public, anon;
grant execute on function public.os_compute_matches(uuid) to authenticated;

-- 3. Membership plan lookup: only your own plan (admins: anyone; service role: anyone)
create or replace function public.membership_effective_plan(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when m.plan_code in ('free','investor_circle') then m.plan_code
    when m.access_until is not null and m.access_until + case when m.payment_method = 'paynow' then interval '7 days' else interval '3 days' end > now() then m.plan_code
    else 'free' end
  from memberships m
  where m.user_id = uid and (uid = auth.uid() or auth.uid() is null or public.is_admin());
$$;
revoke execute on function public.membership_effective_plan(uuid) from public, anon;
grant execute on function public.membership_effective_plan(uuid) to authenticated;
revoke execute on function public.my_membership() from public, anon;
grant execute on function public.my_membership() to authenticated;

-- 4. Fixed search_path on helper functions
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('taxonomy_norm','fix_mojibake','os_touch','os_stage_idx','os_traction_idx','os_to_usd',
                                                         'os_geo_set','os_raise_stage_idx','investor_type_classify') loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

-- 5. Login rate limit: scope lockouts to email + IP so nobody can lock another person out by
--    posting fake failed attempts; no admin bypass (it revealed which emails are admins).
create or replace function public.check_login_rate_limit(p_email text, p_ip text) returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) < 10 from login_attempts
   where lower(email) = lower(p_email) and success = false and coalesce(ip_address, '') = coalesce(p_ip, '')
     and created_at > now() - interval '15 minutes';
$$;
grant execute on function public.check_login_rate_limit(text, text) to anon, authenticated;
create or replace function public.check_login_rate_limit(p_email text) returns boolean
language sql stable security definer set search_path = public as $$ select true; $$;  -- legacy signature (old cached pages)
drop policy if exists login_attempts_insert_anyone on public.login_attempts;
create policy login_attempts_insert_anyone on public.login_attempts for insert to anon, authenticated
  with check (length(coalesce(email, '')) between 3 and 320 and length(coalesce(ip_address, '')) <= 64
              and length(coalesce(user_agent, '')) <= 512 and created_at > now() - interval '5 minutes');

-- 6. Public company directory: anonymous visitors cannot read contact details
revoke select on public.companies from anon;
grant select (id, company_name, logo_url, industry, industries, stage, featured, status, created_at, linkedin_url, website, description) on public.companies to anon;

-- 7. Storage upload limits
update storage.buckets set file_size_limit = 2097152,  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'] where id = 'avatars';
update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['application/pdf','image/jpeg','image/png'] where id = 'kyc';
update storage.buckets set file_size_limit = 52428800, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/svg+xml','application/pdf','video/mp4','video/webm'] where id = 'media';

-- 8. Members can't inflate their own investor relationship / activity data used by the matching score
create or replace function public.guard_investor_self_edit() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or public.os_can('investors.write') then return new; end if;
  new.relationship_strength := old.relationship_strength; new.relationship_owner := old.relationship_owner;
  new.last_interaction_at := old.last_interaction_at; new.active := old.active;
  return new;
end $$;
revoke execute on function public.guard_investor_self_edit() from public, anon, authenticated;
drop trigger if exists investors_guard_self_edit on public.investors;
create trigger investors_guard_self_edit before update on public.investors for each row execute function public.guard_investor_self_edit();
