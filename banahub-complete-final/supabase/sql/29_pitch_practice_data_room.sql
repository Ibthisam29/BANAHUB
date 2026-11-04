-- 29 · Pitch Practice agents (founder → investor, fund manager → LP) + Data Room with access grants and view log

-- ── Pitch Practice ──────────────────────────────────────────────────────
insert into public.site_settings (key, value) values ('pitch_practice', '{"enabled": true, "monthly_cap": 5, "max_turns": 30}')
on conflict (key) do nothing;

create table if not exists public.pitch_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  mode         text not null check (mode in ('founder', 'lp')),
  persona      text not null,
  difficulty   text not null default 'realistic' check (difficulty in ('friendly', 'realistic', 'tough')),
  deal_room_id uuid references public.deal_rooms(id) on delete set null,
  investor_id  uuid references public.investors(id) on delete set null,
  context      text,                                  -- deck text / profile summary the agent used (trimmed)
  transcript   jsonb not null default '[]',           -- [{role:'investor'|'me', text, at}]
  turns        int not null default 0,
  status       text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  score        jsonb,                                  -- {overall, categories:{...}, strengths[], improvements[], questions_to_prepare[]}
  summary      text,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index if not exists pitch_sessions_user_idx on public.pitch_sessions (user_id, created_at desc);
alter table public.pitch_sessions enable row level security;
drop policy if exists pitch_sessions_own_read on public.pitch_sessions;
create policy pitch_sessions_own_read on public.pitch_sessions for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.os_can('raises.read'));
-- all writes go through the pitch-coach edge function (service role) — no member insert/update policies
revoke insert, update, delete on public.pitch_sessions from anon, authenticated;

-- ── Data Room ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('dataroom', 'dataroom', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists dataroom_owner_read   on storage.objects;
drop policy if exists dataroom_owner_insert on storage.objects;
drop policy if exists dataroom_owner_delete on storage.objects;
create policy dataroom_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'dataroom' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy dataroom_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dataroom' and (storage.foldername(name))[1] = auth.uid()::text);
create policy dataroom_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dataroom' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create table if not exists public.data_room_files (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.users(id) on delete cascade,
  deal_room_id uuid references public.deal_rooms(id) on delete cascade,   -- company raise room
  investor_id  uuid references public.investors(id) on delete cascade,    -- fund / LP room
  folder       text not null default 'General',
  name         text not null,
  path         text not null unique,
  size         bigint,
  mime         text,
  note         text,
  created_at   timestamptz not null default now(),
  check ((deal_room_id is not null) <> (investor_id is not null))
);
create index if not exists data_room_files_room_idx on public.data_room_files (deal_room_id, investor_id);

create table if not exists public.data_room_access (
  id           uuid primary key default gen_random_uuid(),
  deal_room_id uuid references public.deal_rooms(id) on delete cascade,
  investor_id  uuid references public.investors(id) on delete cascade,
  grantee_id   uuid not null references public.users(id) on delete cascade,
  granted_by   uuid references public.users(id),
  can_download boolean not null default false,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  check ((deal_room_id is not null) <> (investor_id is not null))
);
create unique index if not exists data_room_access_uniq on public.data_room_access (coalesce(deal_room_id, investor_id), grantee_id) where revoked_at is null;

create table if not exists public.data_room_views (
  id         uuid primary key default gen_random_uuid(),
  file_id    uuid not null references public.data_room_files(id) on delete cascade,
  viewer_id  uuid not null references public.users(id) on delete cascade,
  action     text not null default 'view' check (action in ('view', 'download')),
  viewed_at  timestamptz not null default now()
);
create index if not exists data_room_views_file_idx on public.data_room_views (file_id, viewed_at desc);

-- room ownership helper
create or replace function public.dr_owns(p_deal uuid, p_inv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_deal is not null then exists (select 1 from deal_rooms d where d.id = p_deal and d.submitted_by = auth.uid())
              else exists (select 1 from investors i where i.id = p_inv and i.user_id = auth.uid()) end
$$;
create or replace function public.dr_granted(p_deal uuid, p_inv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from data_room_access a where a.grantee_id = auth.uid() and a.revoked_at is null
    and (a.expires_at is null or a.expires_at > now())
    and ((p_deal is not null and a.deal_room_id = p_deal) or (p_inv is not null and a.investor_id = p_inv)))
$$;
revoke execute on function public.dr_owns(uuid, uuid) from public, anon;
revoke execute on function public.dr_granted(uuid, uuid) from public, anon;
grant execute on function public.dr_owns(uuid, uuid) to authenticated;
grant execute on function public.dr_granted(uuid, uuid) to authenticated;

alter table public.data_room_files  enable row level security;
alter table public.data_room_access enable row level security;
alter table public.data_room_views  enable row level security;

drop policy if exists drf_read   on public.data_room_files;
drop policy if exists drf_insert on public.data_room_files;
drop policy if exists drf_update on public.data_room_files;
drop policy if exists drf_delete on public.data_room_files;
create policy drf_read on public.data_room_files for select to authenticated
  using (owner_id = auth.uid() or public.is_admin() or public.os_can('raises.read') or public.dr_granted(deal_room_id, investor_id));
create policy drf_insert on public.data_room_files for insert to authenticated
  with check (owner_id = auth.uid() and split_part(path, '/', 1) = auth.uid()::text and public.dr_owns(deal_room_id, investor_id));
create policy drf_update on public.data_room_files for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and split_part(path, '/', 1) = auth.uid()::text and public.dr_owns(deal_room_id, investor_id));
create policy drf_delete on public.data_room_files for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- grants are made by BANAHUB staff (manual, curated); room owners and grantees can see them
drop policy if exists dra_read  on public.data_room_access;
drop policy if exists dra_staff on public.data_room_access;
create policy dra_read on public.data_room_access for select to authenticated
  using (grantee_id = auth.uid() or public.is_admin() or public.os_can('raises.write') or public.dr_owns(deal_room_id, investor_id));
create policy dra_staff on public.data_room_access for all to authenticated
  using (public.is_admin() or public.os_can('raises.write')) with check (public.is_admin() or public.os_can('raises.write'));

-- view log: written by the dataroom edge function only; visible to the room owner and staff
drop policy if exists drv_read on public.data_room_views;
create policy drv_read on public.data_room_views for select to authenticated
  using (public.is_admin() or public.os_can('raises.read') or viewer_id = auth.uid()
    or exists (select 1 from data_room_files f where f.id = file_id and f.owner_id = auth.uid()));
revoke insert, update, delete on public.data_room_views from anon, authenticated;

-- viewer names for the room owner's access log (names only, no emails)
create or replace function public.dr_viewer_names(p_ids uuid[]) returns table (id uuid, full_name text, company_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name, u.company_name from users u
  where u.id = any(p_ids) and (public.is_admin() or exists (
    select 1 from data_room_access a where a.grantee_id = u.id and public.dr_owns(a.deal_room_id, a.investor_id)))
$$;
revoke execute on function public.dr_viewer_names(uuid[]) from public, anon;
grant execute on function public.dr_viewer_names(uuid[]) to authenticated;
-- rooms shared with me (grantee view): minimal room labels only
create or replace function public.dr_shared_rooms() returns table (access_id uuid, deal_room_id uuid, investor_id uuid, title text, subtitle text, can_download boolean, expires_at timestamptz, granted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.deal_room_id, a.investor_id,
         coalesce(d.company_name, i.organization, 'Data room'),
         case when d.id is not null then concat_ws(' · ', d.stage, d.hq_country) else concat_ws(' · ', i.investor_type, i.hq_country) end,
         a.can_download, a.expires_at, a.created_at
  from data_room_access a left join deal_rooms d on d.id = a.deal_room_id left join investors i on i.id = a.investor_id
  where a.grantee_id = auth.uid() and a.revoked_at is null and (a.expires_at is null or a.expires_at > now())
$$;
revoke execute on function public.dr_shared_rooms() from public, anon;
grant execute on function public.dr_shared_rooms() to authenticated;
notify pgrst, 'reload schema';
