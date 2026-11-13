-- 32 · Investor intelligence: review queue, provenance, investor documents
-- Records found by Ben (Claude research) or pasted in Admin OS land with review_status = 'ben_review' and active = false.
-- They are excluded from matching and email campaigns until an admin approves them.

alter table public.investors
  add column if not exists source_urls  text[],
  add column if not exists confidence   text check (confidence is null or confidence in ('high','medium','low')),
  add column if not exists verified_at  timestamptz,
  add column if not exists research_notes text,
  add column if not exists added_via    text;          -- ben | paste | import | form | manual
create index if not exists investors_review_idx on public.investors (review_status) where review_status in ('ben_review','rejected');
create index if not exists investors_org_lower_idx on public.investors (lower(organization));

-- matching only considers live, approved records
create or replace function public.os_compute_matches(p_raise uuid)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r deal_rooms; i investors; b jsonb; n int := 0; ckey text;
begin
  if auth.uid() is not null and not public.os_can('matches.write') then raise exception 'Not permitted to run matching'; end if;
  select * into r from deal_rooms where id = p_raise;
  if not found then raise exception 'Raise not found'; end if;
  ckey := coalesce(r.os_company_id::text, r.company_id::text, lower(coalesce(r.company_name, r.name)));
  for i in select * from investors where active is not false and coalesce(review_status, '') not in ('ben_review', 'rejected') loop
    b := os_match_breakdown(r, i);
    insert into os_investor_matches (raise_id, investor_id, company_key, score_total, breakdown, band, flags, computed_at)
    values (r.id, i.id, ckey, (b->>'total')::int, b, b->>'band', array(select jsonb_array_elements_text(b->'flags')), now())
    on conflict (raise_id, investor_id) do update set score_total = excluded.score_total, breakdown = excluded.breakdown, band = excluded.band,
      flags = excluded.flags, computed_at = excluded.computed_at, company_key = excluded.company_key;
    n := n + 1;
  end loop;
  -- drop stale suggestions for investors that are no longer live (keeps any human decisions)
  delete from os_investor_matches m using investors i
   where m.raise_id = r.id and m.investor_id = i.id and m.status = 'suggested'
     and (i.active is false or coalesce(i.review_status, '') in ('ben_review', 'rejected'));
  return n;
end $function$;

-- documents attached to an investor (fund decks, LP letters, portfolio sheets, screenshots, mandates)
create table if not exists public.investor_documents (
  id          uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors(id) on delete cascade,
  name        text not null,
  path        text not null unique,
  mime        text,
  size        bigint,
  kind        text not null default 'other' check (kind in ('deck','mandate','portfolio','lp_letter','research','screenshot','other')),
  note        text,
  uploaded_by uuid references public.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists investor_documents_inv_idx on public.investor_documents (investor_id, created_at desc);
alter table public.investor_documents enable row level security;
drop policy if exists investor_documents_admin on public.investor_documents;
create policy investor_documents_admin on public.investor_documents for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit)
values ('investor-docs', 'investor-docs', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;
drop policy if exists investor_docs_admin_all on storage.objects;
create policy investor_docs_admin_all on storage.objects for all to authenticated
  using (bucket_id = 'investor-docs' and public.is_admin()) with check (bucket_id = 'investor-docs' and public.is_admin());

notify pgrst, 'reload schema';
