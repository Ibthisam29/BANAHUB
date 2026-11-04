-- 30 · Data room plan limits — applied via MCP (see migration 30_data_room_plan_limits). Limits live in site_settings.data_room
-- (free_files, free_mb, free_rooms, paid_files, paid_mb). Trigger data_room_files_limits enforces them on insert,
-- takes size from storage.objects (never the client). Trigger data_room_files_lock freezes path/size/owner/room on update.
-- site_settings.pitch_practice: free_cap, paid_cap, max_turns, free_personas, paid_only_personas.
create or replace function public.data_room_files_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg jsonb; paid boolean; n_files int; n_bytes bigint; n_rooms int; obj_size bigint;
begin
  select (o.metadata->>'size')::bigint into obj_size from storage.objects o where o.bucket_id = 'dataroom' and o.name = new.path;
  if obj_size is null then raise exception 'Upload the file first'; end if;
  new.size := obj_size;
  new.name := left(regexp_replace(coalesce(new.name, ''), '[\r\n\t]', ' ', 'g'), 200);
  new.folder := left(coalesce(nullif(trim(new.folder), ''), 'General'), 80);
  if auth.uid() is null or public.is_admin() then return new; end if;
  select value into cfg from site_settings where key = 'data_room';
  cfg := coalesce(cfg, '{}'::jsonb);
  if coalesce((cfg->>'enabled')::boolean, true) = false then raise exception 'Data Room is currently disabled'; end if;
  paid := coalesce(public.membership_effective_plan(new.owner_id), 'free') <> 'free';
  select count(*), coalesce(sum(size), 0), count(distinct coalesce(deal_room_id, investor_id)) into n_files, n_bytes, n_rooms
    from data_room_files where owner_id = new.owner_id;
  if n_files + 1 > coalesce((cfg->>(case when paid then 'paid_files' else 'free_files' end))::int, 10) then
    raise exception 'File limit reached for your plan — upgrade your membership for more space'; end if;
  if n_bytes + obj_size > coalesce((cfg->>(case when paid then 'paid_mb' else 'free_mb' end))::bigint, 100) * 1048576 then
    raise exception 'Storage limit reached for your plan — upgrade your membership for more space'; end if;
  if not paid and not exists (select 1 from data_room_files f where f.owner_id = new.owner_id and coalesce(f.deal_room_id, f.investor_id) = coalesce(new.deal_room_id, new.investor_id))
     and n_rooms >= coalesce((cfg->>'free_rooms')::int, 1) then
    raise exception 'Free plan includes 1 data room — upgrade your membership for more'; end if;
  return new;
end $$;
revoke execute on function public.data_room_files_limits() from public, anon, authenticated;
drop trigger if exists data_room_files_limits on public.data_room_files;
create trigger data_room_files_limits before insert on public.data_room_files for each row execute function public.data_room_files_limits();
update site_settings set value = value || '{"free_rooms": 1}'::jsonb where key = 'data_room';
create or replace function public.data_room_files_lock() returns trigger language plpgsql set search_path = public as $$
begin new.path := old.path; new.size := old.size; new.owner_id := old.owner_id; new.deal_room_id := old.deal_room_id; new.investor_id := old.investor_id; new.created_at := old.created_at;
  new.name := left(coalesce(nullif(trim(new.name), ''), old.name), 200); new.folder := left(coalesce(nullif(trim(new.folder), ''), 'General'), 80); return new; end $$;
revoke execute on function public.data_room_files_lock() from public, anon, authenticated;
drop trigger if exists data_room_files_lock on public.data_room_files;
create trigger data_room_files_lock before update on public.data_room_files for each row execute function public.data_room_files_lock();
