-- 35 · Investor taxonomy: category, HQ region, sector groups, data quality — derived automatically on every insert/update.
-- Originals (investor_type, investor_subtype, geography, focus_sectors…) are kept; these columns organise them.
alter table public.investors
  add column if not exists category        text,
  add column if not exists category_locked boolean not null default false,   -- true = set by an admin, never auto-overwritten
  add column if not exists hq_region       text,
  add column if not exists sector_groups   text[],
  add column if not exists data_quality    text;

create or replace function public.investor_category(p_type text, p_sub text, p_org text, p_source text) returns text
language sql immutable as $$
  select case
    when lower(coalesce(p_sub,'')) ~ 'corporate' and lower(coalesce(p_sub,'')) !~ '\mlp\M' then 'Corporate VC'
    when lower(coalesce(p_type,'')) = 'angel' or lower(coalesce(p_sub,'')) ~ 'angel' then 'Angels & Syndicates'
    when lower(coalesce(p_type,'')) = 'multi-family office' or lower(coalesce(p_sub,'')) ~ 'multi' then 'Multi-Family Office'
    when lower(coalesce(p_sub,'')) ~ '(wealth|asset manager|investment manager|investment adviser|alternative asset|allocator|consultant)' then 'Asset & Wealth Manager'
    when lower(coalesce(p_sub,'')) ~ '(pension|sovereign|endowment|foundation|insur|development|government|health system|strategic lp)' then 'LP & Institutional'
    when lower(coalesce(p_type,'')) = 'family office' or lower(coalesce(p_sub,'')) ~ '(single.family|family office|family investment|family-owned|family-controlled)' then 'Single-Family Office'
    when lower(coalesce(p_type,'')) = 'private equity' or lower(coalesce(p_sub,'')) ~ '(buyout|turnaround|secondar|private equity)' then 'Private Equity & Growth'
    when lower(coalesce(p_type,'')) = 'hedge fund' then 'Hedge Fund'
    when lower(coalesce(p_type,'')) = 'fund of funds' or lower(coalesce(p_sub,'')) ~ '(fund-of-funds|\mfof\M)' then 'Fund of Funds'
    when lower(coalesce(p_type,'')) = 'lp' then 'LP & Institutional'
    when lower(coalesce(p_type,'')) = 'vc' then 'Venture Capital'
    when p_type is null and lower(coalesce(p_source,'')) ~ 'corporate-vc' then 'Corporate VC'
    when p_type is null and lower(coalesce(p_source,'')) ~ 'family-office' then case when lower(coalesce(p_org,'')) ~ 'multi' then 'Multi-Family Office' else 'Single-Family Office' end
    when p_type is null and lower(coalesce(p_source,'')) ~ 'vc-partners' then 'Venture Capital'
    when p_type is null and lower(coalesce(p_source,'')) ~ 'funds-of-funds' then 'Fund of Funds'
    when lower(coalesce(p_org,'')) ~ '(\mventures?\M|\mvc\M)' then 'Venture Capital'
    when lower(coalesce(p_org,'')) ~ 'family office' then 'Single-Family Office'
    else 'Other / To classify' end
$$;

create or replace function public.investor_region(p_hq text, p_geo text) returns text
language sql immutable as $$
  with t(s) as (select lower(coalesce(nullif(p_hq,''), p_geo, '')))
  select case
    when s = '' then 'Unknown'
    when s ~ 'singapore' then 'Singapore'
    when s ~ '(indonesia|malaysia|vietnam|thailand|philippines|myanmar|cambodia|\mlaos\M|brunei|southeast asia|asean|jakarta|kuala lumpur|bangkok|manila|ho chi minh|hanoi)' then 'Southeast Asia'
    when s ~ '(china|hong kong|taiwan|macau|shanghai|beijing|shenzhen|taipei)' then 'Greater China'
    when s ~ '(japan|korea|tokyo|seoul|osaka|north asia)' then 'Japan & Korea'
    when s ~ '(india|delhi|mumbai|bangalore|bengaluru|pune|chennai|hyderabad|gurgaon|gurugram|noida|kolkata|ahmedabad|pakistan|bangladesh|sri lanka|nepal)' then 'South Asia'
    when s ~ '(\muae\M|dubai|abu dhabi|saudi|riyadh|qatar|doha|bahrain|kuwait|oman|gulf|\mgcc\M|middle east|\mmena\M|israel|egypt|jordan|turkey|istanbul)' then 'Gulf & MENA'
    when s ~ '(united states|\musa\M|\mus\M|california|new york|boston|massachusetts|chicago|texas|michigan|washington|florida|colorado|canada|toronto|vancouver|palo alto|menlo park|san francisco|san mateo|santa monica|los angeles|seattle|illinois|virginia|pennsylvania|ohio|minnesota|connecticut|new jersey|north carolina|utah|arizona|oregon|maryland|tennessee|missouri|wisconsin|indiana|atlanta|austin|north america)' then 'North America'
    when s ~ '(europe|united kingdom|\muk\M|london|england|scotland|germany|france|paris|switzerland|zurich|geneva|sweden|norway|denmark|finland|netherlands|amsterdam|belgium|austria|vienna|italy|rome|milan|spain|madrid|barcelona|portugal|lisbon|ireland|dublin|poland|warsaw|czech|prague|ukraine|kyiv|estonia|luxembourg|scandinavia|nordic|greece|hungary|romania|berlin|munich|stockholm|oslo|copenhagen|helsinki|lithuania|latvia|monaco|liechtenstein)' then 'Europe'
    when s ~ '(australia|new zealand|sydney|melbourne|oceania)' then 'Oceania'
    when s ~ '(brazil|mexico|argentina|chile|colombia|peru|latin america|são paulo|sao paulo)' then 'Latin America'
    when s ~ '(africa|nigeria|kenya|ghana|morocco)' then 'Africa'
    when s ~ '(global|worldwide|international)' then 'Global'
    else 'Unknown' end from t
$$;

create or replace function public.investor_sector_groups(p_sectors text[], p_inds text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct g order by g) filter (where g is not null), '{}') from (
    select case
      when x ~ '(generalist|agnostic)' then 'Generalist'
      when x ~ '(fintech|bank|insur|asset management|financial|payments|wealth)' then 'Fintech & Financial Services'
      when x ~ '(health|life science|medtech|biotech|pharma)' then 'Healthcare'
      when x ~ '(climate|energy|oil|gas|mining|metal|renewable|sustainab)' then 'Climate & Energy'
      when x ~ '(real estate|proptech|property)' then 'Real Estate'
      when x ~ '(consumer|e-commerce|ecommerce|retail|travel|hospitality|food|agri|lifestyle)' then 'Consumer'
      when x ~ '(industrial|hardware|logistics|mobility|chemical|material|infrastructure|manufactur|professional services|business services)' then 'Industrial & Infrastructure'
      when x ~ '(saas|software|\mai\M|data|deep tech|semiconductor|electronic|telecom|web3|digital asset|media|gaming|technology|hr|future of work|education|edtech|cyber|enterprise)' then 'Technology'
      else null end g
    from unnest(coalesce(p_sectors,'{}') || coalesce(p_inds,'{}')) u(y), lateral (select lower(y) x) l
  ) q
$$;

create or replace function public.investors_derive() returns trigger
language plpgsql set search_path to 'public' as $$
declare contact boolean; sector boolean;
begin
  if not coalesce(new.category_locked, false) or new.category is null then
    new.category := investor_category(new.investor_type, new.investor_subtype, new.organization, new.source);
  end if;
  new.hq_region := investor_region(new.hq_country, new.geography);
  new.sector_groups := investor_sector_groups(new.focus_sectors, new.focus_industries);
  contact := coalesce(new.email, new.firm_email, new.linkedin_url, new.phone, new.firm_phone) is not null
             or (jsonb_typeof(new.team) = 'array' and exists (select 1 from jsonb_array_elements(new.team) e where coalesce(e->>'email', e->>'linkedin') is not null));
  sector := coalesce(cardinality(new.sector_groups), 0) > 0;
  new.data_quality := case
    when coalesce(trim(new.organization), '') = '' then 'C'
    when contact and sector and coalesce(cardinality(new.preferred_stages), 0) > 0 and (new.check_min is not null or new.check_max is not null or new.check_size is not null) then 'A'
    when contact and sector then 'B'
    else 'C' end;
  return new;
end $$;
drop trigger if exists investors_zz_derive on public.investors;
create trigger investors_zz_derive before insert or update on public.investors for each row execute function public.investors_derive();
create index if not exists investors_category_idx on public.investors (category);
create index if not exists investors_region_idx on public.investors (hq_region);

-- backfill: missing investor_type from the derived category (flagged for review), then recompute all rows
update public.investors set investor_type = case investor_category(null, investor_subtype, organization, source)
    when 'Corporate VC' then 'VC' when 'Venture Capital' then 'VC' when 'Single-Family Office' then 'Family Office'
    when 'Multi-Family Office' then 'Multi-Family Office' when 'Fund of Funds' then 'Fund of Funds' else null end,
  investor_subtype = coalesce(investor_subtype, case when investor_category(null, investor_subtype, organization, source) = 'Corporate VC' then 'Corporate VC' end),
  type_source = 'inferred', type_needs_review = true
where investor_type is null and coalesce(trim(organization), '') <> ''
  and investor_category(null, investor_subtype, organization, source) in ('Corporate VC','Venture Capital','Single-Family Office','Multi-Family Office','Fund of Funds');
update public.investors set category = null where not category_locked;

notify pgrst, 'reload schema';
