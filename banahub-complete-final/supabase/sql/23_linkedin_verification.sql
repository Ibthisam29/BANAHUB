-- 23 · LinkedIn verification
-- A member is "LinkedIn verified" when a LinkedIn (OpenID Connect) identity is attached to their account —
-- either they signed up with LinkedIn or linked it later from Dashboard → Settings. Set only by the server.

alter table public.users
  add column if not exists linkedin_verified     boolean not null default false,
  add column if not exists linkedin_verified_at  timestamptz,
  add column if not exists linkedin_name         text,
  add column if not exists linkedin_email        text,
  add column if not exists linkedin_picture      text;

create or replace function public.users_sync_linkedin() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb := coalesce(new.identity_data, '{}'::jsonb);
begin
  if new.provider <> 'linkedin_oidc' then return new; end if;
  update public.users set
    linkedin_verified = true,
    linkedin_verified_at = coalesce(linkedin_verified_at, now()),
    linkedin_name = left(coalesce(d->>'name', trim(coalesce(d->>'given_name','') || ' ' || coalesce(d->>'family_name',''))), 200),
    linkedin_email = lower(left(d->>'email', 320)),
    linkedin_picture = left(d->>'picture', 500),
    avatar_url = coalesce(avatar_url, left(d->>'picture', 500))
  where id = new.user_id;
  return new;
end $$;
create or replace function public.users_unsync_linkedin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.provider = 'linkedin_oidc' and not exists (select 1 from auth.identities i where i.user_id = old.user_id and i.provider = 'linkedin_oidc' and i.id <> old.id) then
    update public.users set linkedin_verified = false where id = old.user_id;
  end if;
  return old;
end $$;
revoke execute on function public.users_sync_linkedin() from public, anon, authenticated;
revoke execute on function public.users_unsync_linkedin() from public, anon, authenticated;
drop trigger if exists on_identity_linkedin on auth.identities;
create trigger on_identity_linkedin after insert or update on auth.identities for each row execute function public.users_sync_linkedin();
drop trigger if exists on_identity_linkedin_removed on auth.identities;
create trigger on_identity_linkedin_removed after delete on auth.identities for each row execute function public.users_unsync_linkedin();

-- the public.users row is created by handle_new_auth_user (trigger on auth.users), which may run after the identity
-- insert: re-apply the LinkedIn data once the row exists
create or replace function public.users_apply_linkedin_on_create() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  select identity_data into d from auth.identities where user_id = new.id and provider = 'linkedin_oidc' order by created_at desc limit 1;
  if d is not null then
    new.linkedin_verified := true; new.linkedin_verified_at := now();
    new.linkedin_name := left(coalesce(d->>'name', ''), 200); new.linkedin_email := lower(left(d->>'email', 320));
    new.linkedin_picture := left(d->>'picture', 500); new.avatar_url := coalesce(new.avatar_url, left(d->>'picture', 500));
  end if;
  return new;
end $$;
revoke execute on function public.users_apply_linkedin_on_create() from public, anon, authenticated;
drop trigger if exists users_linkedin_on_create on public.users;
create trigger users_linkedin_on_create before insert on public.users for each row execute function public.users_apply_linkedin_on_create();

-- members cannot set the verification flag themselves
create or replace function public.protect_user_privileges() returns trigger
language plpgsql security definer set search_path = public as $$
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
    new.linkedin_verified := false; new.linkedin_verified_at := null;
    return new;
  end if;
  if new.role is distinct from old.role and not (old.role = 'applicant' and new.role in
       ('member','founder','business','investor','advisor','partner','provider')) then
    raise exception 'only admins can change member role';
  end if;
  if new.status is distinct from old.status or new.blocked is distinct from old.blocked
     or new.email is distinct from old.email or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by or new.id is distinct from old.id
     or new.linkedin_verified is distinct from old.linkedin_verified or new.linkedin_verified_at is distinct from old.linkedin_verified_at
     or new.linkedin_email is distinct from old.linkedin_email or new.linkedin_name is distinct from old.linkedin_name then
    raise exception 'only admins can change account status, email, approval or verification';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- backfill any existing LinkedIn identities
update public.users u set linkedin_verified = true, linkedin_verified_at = coalesce(u.linkedin_verified_at, i.created_at),
  linkedin_name = left(i.identity_data->>'name', 200), linkedin_email = lower(i.identity_data->>'email'), linkedin_picture = left(i.identity_data->>'picture', 500)
from auth.identities i where i.user_id = u.id and i.provider = 'linkedin_oidc';
