-- 28 · Pitch deck uploads for company raises (deal_rooms) and investor profiles (investors)
-- Private bucket `decks`, files stored under <auth.uid()>/…  Readable only by the owner, BANAHUB admins and permitted Admin OS staff.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('decks', 'decks', false, 26214400, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.apple.keynote', 'application/x-iwork-keynote-sffkey'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists decks_owner_read   on storage.objects;
drop policy if exists decks_owner_insert on storage.objects;
drop policy if exists decks_owner_update on storage.objects;
drop policy if exists decks_owner_delete on storage.objects;
create policy decks_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'decks' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin() or public.os_can('raises.read') or public.os_can('investors.read')));
create policy decks_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'decks' and (storage.foldername(name))[1] = auth.uid()::text);
create policy decks_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'decks' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'decks' and (storage.foldername(name))[1] = auth.uid()::text);
create policy decks_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'decks' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

alter table public.deal_rooms add column if not exists deck_path text, add column if not exists deck_name text, add column if not exists deck_size bigint, add column if not exists deck_uploaded_at timestamptz;
alter table public.investors  add column if not exists deck_path text, add column if not exists deck_name text, add column if not exists deck_size bigint, add column if not exists deck_uploaded_at timestamptz;

-- members may only point deck_path at their own folder (staff unrestricted)
create or replace function public.deck_path_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.deck_path is distinct from (case when tg_op = 'UPDATE' then old.deck_path end)
     and new.deck_path is not null and split_part(new.deck_path, '/', 1) <> auth.uid()::text then
    raise exception 'Invalid deck file';
  end if;
  return new;
end $$;
revoke execute on function public.deck_path_guard() from public, anon, authenticated;
drop trigger if exists deal_rooms_deck_guard on public.deal_rooms;
create trigger deal_rooms_deck_guard before insert or update on public.deal_rooms for each row execute function public.deck_path_guard();
drop trigger if exists investors_deck_guard on public.investors;
create trigger investors_deck_guard before insert or update on public.investors for each row execute function public.deck_path_guard();

-- set / clear my deck at any review stage (row-level member update policy only allows edits while submitted / needs_info)
create or replace function public.set_my_deck(p_kind text, p_id uuid, p_path text, p_name text, p_size bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in'; end if;
  if p_path is not null and (split_part(p_path, '/', 1) <> me::text or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,200}$'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'decks' and o.name = p_path)) then
    raise exception 'Upload the file first';
  end if;
  if p_kind = 'raise' then
    update deal_rooms set deck_path = p_path, deck_name = left(p_name, 200), deck_size = p_size, deck_uploaded_at = case when p_path is null then null else now() end
     where id = p_id and submitted_by = me;
  elsif p_kind = 'investor' then
    update investors set deck_path = p_path, deck_name = left(p_name, 200), deck_size = p_size, deck_uploaded_at = case when p_path is null then null else now() end
     where id = p_id and user_id = me;
  else raise exception 'Unknown profile'; end if;
  if not found then raise exception 'Profile not found'; end if;
end $$;
revoke execute on function public.set_my_deck(text, uuid, text, text, bigint) from public, anon;
grant execute on function public.set_my_deck(text, uuid, text, text, bigint) to authenticated;
notify pgrst, 'reload schema';
