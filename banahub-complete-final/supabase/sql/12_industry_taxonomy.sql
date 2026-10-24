-- 12 · Industry taxonomy: one source of truth for industry → sector classification
-- Used by investors (focus_sectors), companies (industry) and capital raises (deal_rooms.sectors).
-- Keywords are normalised phrases (lowercase, punctuation → space). A trailing "." means
-- whole-word only (e.g. 'ai.' matches "ai" but not "air"). Lower prio is tested first.

create table if not exists public.industry_taxonomy (
  sector       text primary key,
  industry     text not null,
  industry_ord int  not null,
  sector_ord   int  not null,
  prio         int  not null,
  keywords     text[] not null default '{}',
  updated_at   timestamptz not null default now()
);
alter table public.industry_taxonomy enable row level security;
drop policy if exists "taxonomy readable" on public.industry_taxonomy;
create policy "taxonomy readable" on public.industry_taxonomy for select to anon, authenticated using (true);
drop policy if exists "taxonomy admin write" on public.industry_taxonomy;
create policy "taxonomy admin write" on public.industry_taxonomy for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.industry_taxonomy (sector, industry, industry_ord, sector_ord, prio, keywords) values
 ('SaaS / Software',            'Technology',                  1, 1, 10, '{saas,software,b2b,enterprise,cloud,dev tools,devtools,productivity,it services,it.,hosting,digital transformation}'),
 ('AI / Data',                  'Technology',                  1, 2,  5, '{ai.,artificial intelligence,machine learning,ml.,gen ai,genai,llm,data,analytics}'),
 ('Cybersecurity',              'Technology',                  1, 3,  4, '{cyber,security.,identity,infosec}'),
 ('Electronics / Semiconductors','Technology',                 1, 4,  8, '{semiconductor,electronic,chip,display,optical}'),
 ('Deep Tech',                  'Technology',                  1, 5,  9, '{deep tech,deeptech,quantum,space tech,space.,advanced material,photonics}'),
 ('Web3 / Digital Assets',      'Technology',                  1, 6,  2, '{web3,web 3,crypto,blockchain,defi,digital asset,nft,tokeni}'),
 ('Telecom',                    'Technology',                  1, 7, 24, '{telecom,telco,connectivity,5g.,wireless,network operator}'),
 ('Fintech',                    'Financial Services',          2, 1,  3, '{fintech,fin tech,payment,neobank,regtech,wealthtech,wealth tech,insurtech,insur tech,lending,embedded finance}'),
 ('Banking / Insurance',        'Financial Services',          2, 2, 25, '{bank,insurance,insurer,reinsurance,financial services,mutual,retirement,pension}'),
 ('Asset Management',           'Financial Services',          2, 3, 26, '{asset manag,investment manag,wealth manag,fund of funds,funds of funds,private markets,family office}'),
 ('MedTech / Devices',          'Healthcare',                  3, 1,  6, '{medtech,med tech,medical device,medical,diagnostic,surgical}'),
 ('Healthcare / Life Sciences', 'Healthcare',                  3, 2,  7, '{health,biotech,bio tech,life science,pharma,wellness,femtech,therapeutic,clinical,hospital}'),
 ('Consumer / E-commerce',      'Consumer & Lifestyle',        4, 1, 17, '{consumer,e commerce,ecommerce,retail,d2c,dtc,fmcg,beverage,fashion,beauty,marketplace,lifestyle,luxury,cpg}'),
 ('Media / Gaming',             'Consumer & Lifestyle',        4, 2, 21, '{media,entertainment,gaming,games,content,creator,sports,music,advertising,adtech,marketing tech,martech}'),
 ('Travel / Hospitality',       'Consumer & Lifestyle',        4, 3, 23, '{travel,hospitality,tourism,hotel}'),
 ('Education',                  'Consumer & Lifestyle',        4, 4, 18, '{edtech,ed tech,education,learning,school}'),
 ('Industrial / Hardware',      'Industrial & Infrastructure', 5, 1, 20, '{industrial,manufactur,hardware,robotic,iot.,automation,aerospace,defence,defense,machinery,engineering}'),
 ('Logistics / Mobility',       'Industrial & Infrastructure', 5, 2, 19, '{logistic,supply chain,transport,mobility,shipping,automotive,ev.,freight,aviation,maritime}'),
 ('Real Estate / PropTech',     'Industrial & Infrastructure', 5, 3, 15, '{proptech,prop tech,real estate,property,construction,contech,con tech,infrastructure,built environment}'),
 ('Climate / Energy',           'Energy & Resources',          6, 1, 11, '{climate,cleantech,clean tech,energy,renewable,sustainab,esg.,green,carbon,solar,battery,circular,utilit,hydrogen,water}'),
 ('Oil & Gas',                  'Energy & Resources',          6, 2, 12, '{oil.,gas.,petroleum,lng.,upstream,refin}'),
 ('Mining / Metals',            'Energy & Resources',          6, 3, 13, '{mining,mine.,metal,iron ore,copper,gold.,silver.,lithium,nickel,mineral,steel,coal,emerald,gemstone}'),
 ('Chemicals / Materials',      'Energy & Resources',          6, 4, 14, '{chemical,materials,plastic,polymer,packaging}'),
 ('Agri / Food Tech',           'Energy & Resources',          6, 5, 16, '{agri,agtech,ag tech,food,aquaculture,farming,farm.,fishery,alternative protein}'),
 ('HR / Future of Work',        'Business Services',           7, 1, 22, '{hr.,hrtech,hr tech,human resources,future of work,workforce,recruit,talent,staffing}'),
 ('Professional Services',      'Business Services',           7, 2, 27, '{consulting,professional services,legal,law firm,accounting,advisory,outsourcing,bpo.}'),
 ('Generalist',                 'Sector-agnostic',             8, 1,  1, '{generalist,agnostic,all sectors,sector neutral,multi sector,diversified,any.,all.}')
on conflict (sector) do update set industry = excluded.industry, industry_ord = excluded.industry_ord, sector_ord = excluded.sector_ord,
  prio = excluded.prio, keywords = excluded.keywords, updated_at = now();

-- normalise free text the same way the admin JS does
create or replace function public.taxonomy_norm(t text) returns text
language sql immutable as $$ select trim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g')) $$;

-- free text → canonical sector (exact name first, then keyword rules by prio)
create or replace function public.canonical_sector(t text) returns text
language sql stable set search_path = public as $$
  select coalesce(
    (select sector from industry_taxonomy where taxonomy_norm(sector) = taxonomy_norm(t) limit 1),
    (select sector from industry_taxonomy x
      where exists (select 1 from unnest(x.keywords) k
                    where taxonomy_norm(t) ~ ('(^|[^a-z0-9])' || case when right(k, 1) = '.' then left(k, -1) || '($|[^a-z0-9])' else k end))
      order by prio limit 1));
$$;

-- sector list → ordered, distinct industries ('Other' for anything unrecognised)
create or replace function public.sectors_to_industries(s text[]) returns text[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(ind order by ord), '{}') from (
    select distinct coalesce(x.industry, 'Other') ind, coalesce(x.industry_ord, 99) ord
    from unnest(coalesce(s, '{}')) v
    left join industry_taxonomy x on x.sector = canonical_sector(v)
    where trim(coalesce(v, '')) <> ''
  ) q;
$$;

-- ── investors ───────────────────────────────────────────────────────────────
alter table public.investors add column if not exists focus_industries text[] not null default '{}';
alter table public.investors add column if not exists sector_source text;   -- stated | inferred | manual
create index if not exists investors_focus_industries_gin on public.investors using gin (focus_industries);
create index if not exists investors_focus_sectors_gin on public.investors using gin (focus_sectors);

create or replace function public.investors_set_industries() returns trigger
language plpgsql set search_path = public as $$
begin
  new.focus_industries := sectors_to_industries(new.focus_sectors);
  if coalesce(cardinality(new.focus_sectors), 0) = 0 then new.sector_source := null;
  elsif new.sector_source is null then new.sector_source := 'stated';
  end if;
  return new;
end $$;
drop trigger if exists investors_industries on public.investors;
create trigger investors_industries before insert or update of focus_sectors, sector_source on public.investors
  for each row execute function public.investors_set_industries();

-- ── companies (industry[] holds sectors/sub-industries) ──────────────────────
alter table public.companies add column if not exists industries text[] not null default '{}';
create index if not exists companies_industries_gin on public.companies using gin (industries);
create or replace function public.companies_set_industries() returns trigger
language plpgsql set search_path = public as $$
begin new.industries := sectors_to_industries(new.industry); return new; end $$;
drop trigger if exists companies_industries on public.companies;
create trigger companies_industries before insert or update of industry on public.companies
  for each row execute function public.companies_set_industries();

-- ── capital raises (deal_rooms) ─────────────────────────────────────────────
alter table public.deal_rooms add column if not exists industries text[] not null default '{}';
create or replace function public.deal_rooms_set_industries() returns trigger
language plpgsql set search_path = public as $$
begin
  new.industries := sectors_to_industries(coalesce(new.sectors, '{}') || case when coalesce(new.industry, '') <> '' then array[new.industry] else '{}' end);
  if coalesce(new.industry, '') = '' and cardinality(new.industries) > 0 then new.industry := new.industries[1]; end if;
  return new;
end $$;
drop trigger if exists deal_rooms_industries on public.deal_rooms;
create trigger deal_rooms_industries before insert or update of sectors, industry on public.deal_rooms
  for each row execute function public.deal_rooms_set_industries();

-- backfill
update public.investors set focus_sectors = focus_sectors;
update public.companies set industry = industry;
update public.deal_rooms set sectors = sectors;
