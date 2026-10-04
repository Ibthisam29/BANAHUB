-- 10_enquiry_tracking.sql
-- Contact-form enquiries: full field capture + admin tracking pipeline.
-- Run after BANAHUB_SETUP_ALL.sql (02–09). Idempotent.

alter table enquiries add column if not exists type text;           -- company | investor | partner | event | program | general
alter table enquiries add column if not exists phone text;
alter table enquiries add column if not exists title text;          -- job title
alter table enquiries add column if not exists service text;        -- service of interest
alter table enquiries add column if not exists data jsonb default '{}'::jsonb;  -- every other form field
alter table enquiries add column if not exists priority text default 'normal';  -- low | normal | high
alter table enquiries add column if not exists notes text;          -- internal admin notes
alter table enquiries add column if not exists assigned_to text;
alter table enquiries add column if not exists page_url text;       -- page the form was submitted from
alter table enquiries add column if not exists responded_at timestamptz;
alter table enquiries add column if not exists updated_at timestamptz default now();

-- Pipeline: new → in_progress → responded → closed   (legacy 'pending' = new, 'resolved' = closed)
update enquiries set status = 'new'    where status in ('pending') or status is null;
update enquiries set status = 'closed' where status = 'resolved';
alter table enquiries alter column status set default 'new';

-- Basic abuse limits on the public insert path
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'enquiries_size_limits') then
    alter table enquiries add constraint enquiries_size_limits check (
      length(coalesce(message, '')) <= 8000 and length(coalesce(name, '')) <= 200 and
      length(coalesce(email, '')) <= 320 and length(coalesce(company, '')) <= 300 and
      pg_column_size(coalesce(data, '{}'::jsonb)) <= 16000
    ) not valid;
  end if;
end $$;

-- Public may only insert NEW enquiries (cannot pre-set status/notes/priority)
drop policy if exists "enquiries_insert_anyone" on enquiries;
create policy "enquiries_insert_anyone" on enquiries for insert
  with check (coalesce(status, 'new') = 'new' and notes is null and assigned_to is null and responded_at is null);

create index if not exists enquiries_created_idx on enquiries (created_at desc);
create index if not exists enquiries_status_idx on enquiries (status);

-- Every new enquiry raises an admin notification (bell icon in Admin OS)
create or replace function public.notify_new_enquiry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into admin_notifications (title, body)
  values ('New ' || coalesce(new.type, 'contact') || ' enquiry',
          coalesce(new.name, '') || ' <' || coalesce(new.email, '') || '>' ||
          case when coalesce(new.company, '') <> '' then ' · ' || new.company else '' end);
  return new;
end; $$;
drop trigger if exists trg_notify_new_enquiry on enquiries;
create trigger trg_notify_new_enquiry after insert on enquiries
  for each row execute function public.notify_new_enquiry();

-- keep updated_at fresh on admin edits
create or replace function public.touch_enquiry()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_touch_enquiry on enquiries;
create trigger trg_touch_enquiry before update on enquiries
  for each row execute function public.touch_enquiry();
