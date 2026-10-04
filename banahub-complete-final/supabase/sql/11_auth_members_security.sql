-- 11_auth_members_security.sql
-- Google / LinkedIn sign-in, admin approval gate, member profiles, CRM,
-- private KYC storage, and fixes for every self-approval hole found in the
-- live-project audit (2026-10-04). Run after 10. Idempotent.

-- ══════════════════════════════════════════════════════════════════
-- 1. MEMBER PROFILE COLUMNS
-- ══════════════════════════════════════════════════════════════════
alter table users add column if not exists title text;
alter table users add column if not exists linkedin_url text;
alter table users add column if not exists website text;
alter table users add column if not exists bio text;
alter table users add column if not exists avatar_url text;
alter table users add column if not exists auth_provider text;          -- email | google | linkedin_oidc
alter table users add column if not exists preferences jsonb default '{}'::jsonb;
alter table users add column if not exists approved_at timestamptz;
alter table users add column if not exists approved_by uuid;
alter table users add column if not exists updated_at timestamptz default now();
alter table users add column if not exists last_seen_at timestamptz;

-- Allowed values (blocks stored-XSS / junk in role & status)
update users set role = 'applicant' where role is null or role not in
  ('applicant','member','founder','business','investor','advisor','partner','provider','admin');
update users set status = 'pending' where status is null or status not in
  ('pending','vetting','approved','rejected','blocked','invited');
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in
  ('applicant','member','founder','business','investor','advisor','partner','provider','admin'));
alter table users drop constraint if exists users_status_check;
alter table users add constraint users_status_check check (status in
  ('pending','vetting','approved','rejected','blocked','invited'));

-- ══════════════════════════════════════════════════════════════════
-- 2. HELPERS
-- ══════════════════════════════════════════════════════════════════
create or replace function public.is_approved_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u
                 where u.id = auth.uid() and (u.status = 'approved' or u.role = 'admin')
                   and coalesce(u.blocked, false) = false);
$$;
revoke all on function public.is_approved_member() from public, anon;
grant execute on function public.is_approved_member() to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 3. EVERY SIGN-UP (email, Google, LinkedIn) → pending users row,
--    created server-side so the browser can never pick role/status.
-- ══════════════════════════════════════════════════════════════════
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  req_role text := lower(coalesce(meta->>'role', ''));
  prov text := coalesce(new.raw_app_meta_data->>'provider', 'email');
begin
  if req_role not in ('member','founder','business','investor','advisor','partner','provider') then
    req_role := 'applicant';
  end if;
  begin
    insert into public.users (id, email, full_name, avatar_url, auth_provider, role, status)
    values (new.id, lower(new.email),
            left(coalesce(meta->>'full_name', meta->>'name', trim(coalesce(meta->>'given_name','') || ' ' || coalesce(meta->>'family_name',''))), 200),
            left(coalesce(meta->>'avatar_url', meta->>'picture'), 500),
            prov, req_role, 'pending')
    on conflict (id) do nothing;
  exception when unique_violation then
    -- an invited row already exists for this email: attach it to the new auth id
    update public.users set id = new.id, auth_provider = prov
     where lower(email) = lower(new.email) and status = 'invited';
  end;
  insert into public.admin_notifications (title, body)
  values ('New member sign-up (' || prov || ')', coalesce(new.email, '') || ' is awaiting approval');
  return new;
end; $$;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
do $$ begin execute 'grant execute on function public.handle_new_auth_user() to supabase_auth_admin'; exception when undefined_object then null; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Backfill any auth users that have no users row yet
insert into public.users (id, email, full_name, auth_provider, role, status)
select a.id, lower(a.email), coalesce(a.raw_user_meta_data->>'full_name', a.raw_user_meta_data->>'name'),
       coalesce(a.raw_app_meta_data->>'provider', 'email'), 'applicant', 'pending'
  from auth.users a
 where not exists (select 1 from public.users u where u.id = a.id)
   and not exists (select 1 from public.users u where lower(u.email) = lower(a.email))
on conflict do nothing;

-- ══════════════════════════════════════════════════════════════════
-- 4. USERS: protected fields (replaces 09 trigger function)
--    Members may edit their own profile, but never role (except the
--    one-time choice from 'applicant'), status, blocked, email, approval.
-- ══════════════════════════════════════════════════════════════════
create or replace function public.protect_user_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then
    if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' then
      new.approved_at := now(); new.approved_by := auth.uid();
    end if;
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.role, 'applicant') = 'admin' then raise exception 'not allowed to self-assign admin role'; end if;
    new.status := 'pending'; new.blocked := false; new.approved_at := null; new.approved_by := null;
    return new;
  end if;
  if new.role is distinct from old.role and not (old.role = 'applicant' and new.role in
       ('member','founder','business','investor','advisor','partner','provider')) then
    raise exception 'only admins can change member role';
  end if;
  if new.status is distinct from old.status or new.blocked is distinct from old.blocked
     or new.email is distinct from old.email or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by or new.id is distinct from old.id then
    raise exception 'only admins can change account status, email or approval';
  end if;
  new.updated_at := now();
  return new;
end; $$;
revoke all on function public.protect_user_privileges() from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 5. CLOSE SELF-APPROVAL HOLES
-- ══════════════════════════════════════════════════════════════════
-- 5a. companies / investors / advisors: owners could set status='approved'
create or replace function public.guard_listing_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'pending'; new.featured := false;
  else
    new.status := old.status; new.featured := old.featured; new.user_id := old.user_id;
  end if;
  return new;
end; $$;
revoke all on function public.guard_listing_status() from public, anon, authenticated;
do $$ declare t text; begin
  foreach t in array array['companies','investors','advisors'] loop
    execute format('drop trigger if exists trg_guard_listing_status on %I', t);
    execute format('create trigger trg_guard_listing_status before insert or update on %I for each row execute function public.guard_listing_status()', t);
  end loop;
end $$;

-- 5b. KYC: members could mark their own upload "verified"
drop policy if exists "kyc_own_all" on kyc_uploads;
drop policy if exists "kyc_own_read" on kyc_uploads;
drop policy if exists "kyc_own_insert" on kyc_uploads;
drop policy if exists "kyc_own_delete_pending" on kyc_uploads;
create policy "kyc_own_read" on kyc_uploads for select using (auth.uid() = user_id);
create policy "kyc_own_insert" on kyc_uploads for insert with check (auth.uid() = user_id and coalesce(status, 'pending') = 'pending');
create policy "kyc_own_delete_pending" on kyc_uploads for delete using (auth.uid() = user_id and status = 'pending');
alter table kyc_uploads add column if not exists storage_path text;
alter table kyc_uploads add column if not exists file_name text;
alter table kyc_uploads add column if not exists review_notes text;
alter table kyc_uploads add column if not exists reviewed_at timestamptz;

-- 5c. applications: could be inserted pre-approved
drop policy if exists "applications_own_insert" on applications;
create policy "applications_own_insert" on applications for insert
  with check (auth.uid() = user_id and coalesce(status, 'pending') = 'pending');

-- 5d. access requests: could be inserted already 'approved' (self-granted data access)
drop policy if exists "access_requests_own_insert" on access_requests;
create policy "access_requests_own_insert" on access_requests for insert
  with check (auth.uid() = requester_id and coalesce(status, 'pending') = 'pending'
              and reviewed_by is null and reviewed_at is null and expires_at is null
              and public.is_approved_member());

-- 5e. introductions: same
drop policy if exists "introductions_own_insert" on introductions;
create policy "introductions_own_insert" on introductions for insert
  with check (auth.uid() = requester_id and coalesce(status, 'pending') = 'pending' and public.is_approved_member());

-- 5f. deal rooms: any user could create (and publish) a raise
drop policy if exists "deal_rooms_own_insert" on deal_rooms;

-- 5g. messages: only approved members
drop policy if exists "messages_own_insert" on messages;
create policy "messages_own_insert" on messages for insert
  with check (auth.uid() = sender_id and public.is_approved_member());

-- 5h. activity log: members could forge admin entries
drop policy if exists "activity_logs_insert_authenticated" on activity_logs;
create policy "activity_logs_insert_authenticated" on activity_logs for insert
  with check (auth.role() = 'authenticated'
              and (public.is_admin() or (action not like 'admin.%' and coalesce(category, '') <> 'admin'
                   and lower(coalesce(actor_email, '')) = lower(coalesce(auth.email(), '')))));

-- 5i. Login lockout DoS: anyone could insert fake failures for the admin email.
--     Admin accounts are exempt from the client-side lockout (Supabase Auth
--     still rate-limits sign-ins server-side); others need 10 failures.
create or replace function public.check_login_rate_limit(p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare fail_count int;
begin
  if exists (select 1 from users where lower(email) = lower(p_email) and role = 'admin') then return true; end if;
  select count(*) into fail_count from login_attempts
   where lower(email) = lower(p_email) and success = false and created_at > now() - interval '15 minutes';
  return fail_count < 10;
end; $$;
alter table login_attempts drop constraint if exists login_attempts_size;
alter table login_attempts add constraint login_attempts_size check (length(email) <= 320 and length(coalesce(user_agent,'')) <= 1000 and length(coalesce(ip_address,'')) <= 100) not valid;

-- 5j. Member-only capital raises: pending / blocked users no longer see them
create or replace view member_capital_raises as
  select d.id,
         coalesce(d.name, d.company_name, c.company_name) as name,
         coalesce(d.company_name, c.company_name)         as company_name,
         d.industry, d.sectors, d.investment_type, d.stage, d.target_raise, d.raised_amount,
         d.min_ticket, d.currency, d.geography, d.close_date, d.description, d.status, d.created_at
    from deal_rooms d
    left join companies c on c.id = d.company_id
   where d.status = 'open' and d.published = true and public.is_approved_member();
revoke all on member_capital_raises from anon, public;
grant select on member_capital_raises to authenticated;

-- 5k. Function hygiene (Supabase advisor warnings)
alter function public.get_transaction_status(text) set search_path = public;
alter function public.notify_admin_on_login_attempt() set search_path = public;
alter function public.set_pricing_updated_at() set search_path = public;
alter function public.touch_enquiry() set search_path = public;
revoke all on function public.notify_admin_on_login_attempt() from public, anon, authenticated;
revoke all on function public.notify_new_enquiry() from public, anon, authenticated;
revoke all on function public.set_pricing_updated_at() from public, anon, authenticated;
revoke all on function public.touch_enquiry() from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 6. PRIVATE STORAGE: KYC documents + member avatars
-- ══════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public) values ('kyc', 'kyc', false) on conflict (id) do update set public = false;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;

drop policy if exists "kyc_owner_upload" on storage.objects;
create policy "kyc_owner_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'kyc' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "kyc_owner_or_admin_read" on storage.objects;
create policy "kyc_owner_or_admin_read" on storage.objects for select to authenticated
  using (bucket_id = 'kyc' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "kyc_admin_delete" on storage.objects;
create policy "kyc_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'kyc' and public.is_admin());

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ══════════════════════════════════════════════════════════════════
-- 7. CRM — full pipeline fields (admin-only via crm_contacts_admin_all)
-- ══════════════════════════════════════════════════════════════════
alter table crm_contacts add column if not exists company text;
alter table crm_contacts add column if not exists title text;
alter table crm_contacts add column if not exists phone text;
alter table crm_contacts add column if not exists linkedin_url text;
alter table crm_contacts add column if not exists source text;           -- enquiry | member | event | referral | import | manual
alter table crm_contacts add column if not exists source_id uuid;        -- enquiry / user id it came from
alter table crm_contacts add column if not exists deal_value numeric;
alter table crm_contacts add column if not exists currency text default 'SGD';
alter table crm_contacts add column if not exists owner text;
alter table crm_contacts add column if not exists next_action text;
alter table crm_contacts add column if not exists next_action_date date;
alter table crm_contacts add column if not exists tags text[];
alter table crm_contacts add column if not exists last_contacted_at timestamptz;
alter table crm_contacts add column if not exists updated_at timestamptz default now();
create index if not exists crm_contacts_stage_idx on crm_contacts (pipeline_stage);
create index if not exists crm_contacts_email_idx on crm_contacts (lower(email));

create table if not exists crm_activities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references crm_contacts(id) on delete cascade,
  kind text default 'note',          -- note | call | email | meeting | stage
  body text,
  created_by text,
  created_at timestamptz default now()
);
alter table crm_activities enable row level security;
drop policy if exists "crm_activities_admin_all" on crm_activities;
create policy "crm_activities_admin_all" on crm_activities for all
  using (public.is_admin()) with check (public.is_admin());
