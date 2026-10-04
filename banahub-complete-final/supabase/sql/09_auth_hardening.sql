-- 09_auth_hardening.sql
-- Fixes in the base `users` table policies. Run after 01–08. Idempotent.
--
-- 1. RECURSION: "users_admin_all" queried `users` from inside a policy ON
--    `users` → Postgres raises "infinite recursion detected in policy for
--    relation users" for every authenticated query that touches any table
--    whose admin policy checks users.role. is_admin() is SECURITY DEFINER,
--    so it reads users without re-entering RLS. Other tables keep their
--    exists(select 1 from users u where u.id = auth.uid() and u.role = 'admin')
--    check, which now resolves cleanly.
-- 2. PRIVILEGE ESCALATION: "users_own_update" let any member set their own
--    role = 'admin'. A trigger now blocks non-admins from changing
--    role / status / blocked fields (on insert or update).
-- 3. SIGNUP: no INSERT policy existed, so /auth/register could never create
--    the member's users row. Members may insert ONLY their own row, never as admin.
-- 4. Columns the register form already sends.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "users_admin_all" on users;
create policy "users_admin_all" on users for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "users_own_insert" on users;
create policy "users_own_insert" on users for insert
  with check (auth.uid() = id and coalesce(role, 'applicant') <> 'admin' and coalesce(status, 'pending') = 'pending');

drop policy if exists "users_own_update" on users;
create policy "users_own_update" on users for update
  using (auth.uid() = id) with check (auth.uid() = id);

alter table users add column if not exists country text;
alter table users add column if not exists phone text;

-- Role / status protection: only admins (or server-side code with no JWT,
-- e.g. SQL editor / service_role) may change these fields.
create or replace function public.protect_user_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.role, 'applicant') = 'admin' then
      raise exception 'not allowed to self-assign admin role';
    end if;
    new.status := 'pending';
    return new;
  end if;
  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.blocked is distinct from old.blocked then
    raise exception 'only admins can change role or account status';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_user_privileges on users;
create trigger trg_protect_user_privileges
  before insert or update on users
  for each row execute function public.protect_user_privileges();
