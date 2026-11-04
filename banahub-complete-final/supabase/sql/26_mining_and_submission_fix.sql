-- 26 · Fix member raise submissions (mandate_status / shortlist are NOT NULL) + Mining & Metals industry

-- 1. member guard: use the column defaults instead of NULL for required fields
create or replace function public.deal_rooms_member_guard() returns trigger
language plpgsql set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or public.is_admin() or public.os_can('raises.write') then return new; end if;
  new.submitted_by := auth.uid(); new.created_by := auth.uid(); new.published := false;
  if tg_op = 'INSERT' then
    select count(*) into n from deal_rooms where submitted_by = auth.uid() and created_at > now() - interval '30 days';
    if n >= 10 then raise exception 'Submission limit reached — contact BANAHUB'; end if;
    new.status := 'submitted'; new.pipeline_stage := 'new'; new.review_status := 'submitted'; new.review_note := null; new.submitted_at := now();
    new.os_owner_id := null; new.mandate_status := 'none'; new.mandate_signed_at := null; new.probability := null; new.shortlist := '[]'::jsonb;
    new.os_company_id := null; new.os_opportunity_id := null; new.lost_reason := null; new.company_id := null;
    new.next_action := 'Review member submission'; new.next_action_date := current_date + 2;
    new.campaign_status := null; new.campaign_paid_at := null; new.campaign_amount := null; new.campaign_currency := null; new.campaign_session := null;
  else
    new.status := old.status; new.pipeline_stage := old.pipeline_stage; new.review_note := old.review_note; new.submitted_at := old.submitted_at;
    new.review_status := case when old.review_status = 'needs_info' then 'submitted' else old.review_status end;
    new.os_owner_id := old.os_owner_id; new.mandate_status := old.mandate_status; new.mandate_signed_at := old.mandate_signed_at;
    new.probability := old.probability; new.shortlist := old.shortlist; new.os_company_id := old.os_company_id; new.os_opportunity_id := old.os_opportunity_id;
    new.lost_reason := old.lost_reason; new.company_id := old.company_id; new.next_action := old.next_action; new.next_action_date := old.next_action_date;
    new.campaign_status := old.campaign_status; new.campaign_paid_at := old.campaign_paid_at; new.campaign_amount := old.campaign_amount;
    new.campaign_currency := old.campaign_currency; new.campaign_session := old.campaign_session;
  end if;
  return new;
end $$;
revoke execute on function public.deal_rooms_member_guard() from public, anon, authenticated;

-- 2. Mining & Metals becomes its own industry with commodity sub-sectors
update public.industry_taxonomy set industry_ord = industry_ord + 1 where industry_ord >= 7;  -- Business Services → 8, Sector-agnostic → 9
update public.industry_taxonomy set industry = 'Mining & Metals', industry_ord = 7, sector_ord = 99, sector = 'Mining / Metals' where sector = 'Mining / Metals';
insert into public.industry_taxonomy (sector, industry, industry_ord, sector_ord, prio, keywords) values
  ('Gold',                       'Mining & Metals', 7, 1,  12, array['gold.','gold mine','gold mining','gold explor']),
  ('Silver',                     'Mining & Metals', 7, 2,  12, array['silver.','silver mine','silver mining']),
  ('Copper',                     'Mining & Metals', 7, 3,  12, array['copper']),
  ('Aluminium / Bauxite',        'Mining & Metals', 7, 4,  12, array['alumin','bauxite']),
  ('Iron ore / Steel',           'Mining & Metals', 7, 5,  12, array['iron ore','iron.','steel']),
  ('Nickel',                     'Mining & Metals', 7, 6,  12, array['nickel']),
  ('Lithium / Battery metals',   'Mining & Metals', 7, 7,  12, array['lithium','cobalt','graphite','battery metal','manganese']),
  ('Rare earths',                'Mining & Metals', 7, 8,  12, array['rare earth','ree.']),
  ('Zinc / Lead / Tin',          'Mining & Metals', 7, 9,  12, array['zinc','lead mine','tin mine','tin.']),
  ('Platinum group metals',      'Mining & Metals', 7, 10, 12, array['platinum','palladium','pgm.']),
  ('Coal',                       'Mining & Metals', 7, 11, 12, array['coal']),
  ('Uranium',                    'Mining & Metals', 7, 12, 12, array['uranium']),
  ('Gemstones / Precious stones','Mining & Metals', 7, 13, 12, array['emerald','gemstone','diamond','sapphire','ruby','precious stone']),
  ('Industrial minerals',        'Mining & Metals', 7, 14, 12, array['industrial mineral','phosphate','potash','silica','limestone']),
  ('Mining services / Equipment','Mining & Metals', 7, 15, 12, array['mining service','mining equipment','drilling','mine services'])
on conflict (sector) do update set industry = excluded.industry, industry_ord = excluded.industry_ord, sector_ord = excluded.sector_ord, prio = excluded.prio, keywords = excluded.keywords, updated_at = now();
update public.industry_taxonomy set keywords = array['mining','mine.','metal','mineral','resources compan'], prio = 13 where sector = 'Mining / Metals';
update public.industry_taxonomy set updated_at = now() where industry = 'Mining & Metals';

-- recompute derived industries for rows that use any mining sector
update public.investors set focus_sectors = focus_sectors where focus_sectors && (select array_agg(sector) from public.industry_taxonomy where industry = 'Mining & Metals');
update public.deal_rooms set sectors = sectors where sectors && (select array_agg(sector) from public.industry_taxonomy where industry = 'Mining & Metals');
update public.partners set sectors = sectors where sectors && (select array_agg(sector) from public.industry_taxonomy where industry = 'Mining & Metals');
update public.companies set industry = industry where industry && (select array_agg(sector) from public.industry_taxonomy where industry = 'Mining & Metals');
notify pgrst, 'reload schema';
