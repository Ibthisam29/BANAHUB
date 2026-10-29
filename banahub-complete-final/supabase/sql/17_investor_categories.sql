-- 17 · Investor categories
-- investor_type is now one of eight categories (+ Other):
--   VC · Angel · Family Office · Multi-Family Office · Private Equity · Hedge Fund · Fund of Funds · LP
-- The finer label moves to investor_subtype (Corporate VC, Accelerator, Pension, Endowment, Asset manager,
-- Investment consultant, Wealth manager, Secondaries, Growth equity, Bank / Debt, Sovereign / Government …).
-- type_source: stated (from the source data) | inferred (from the firm name) | manual (edited in Admin OS)
-- type_needs_review: the category is a best guess and should be confirmed.

alter table public.investors
  add column if not exists investor_subtype  text,
  add column if not exists type_source       text,
  add column if not exists type_needs_review boolean not null default false;

-- free text → {category, subtype}
create or replace function public.investor_type_classify(t text) returns text[]
language sql immutable as $$
  with x as (select lower(trim(coalesce(t, ''))) v, trim(coalesce(t, '')) raw)
  select case
    when v = '' then array[null, null]
    when v in ('vc','angel','family office','multi-family office','private equity','hedge fund','fund of funds','lp','other') then
      array[(array['VC','Angel','Family Office','Multi-Family Office','Private Equity','Hedge Fund','Fund of Funds','LP','Other'])
            [array_position(array['vc','angel','family office','multi-family office','private equity','hedge fund','fund of funds','lp','other'], v)], null]
    when v = 'lp / fund of funds' then array['LP', null]                              -- old combined label: needs a decision
    when v ~ 'multi.?family|\mmfo\M|wealth manag|private bank|private wealth' then array['Multi-Family Office', case when v ~ 'wealth|private bank' then raw end]
    when v ~ 'family office|\msfo\M|\mfo\M|single family' then array['Family Office', null]
    when v ~ 'fund.?of.?(hedge.?)?funds|\mfofs?\M|secondar' then array['Fund of Funds', case when v ~ 'secondar' then 'Secondaries' when v ~ 'hedge' then 'Fund of hedge funds' end]
    when v ~ 'hedge' then array['Hedge Fund', null]
    when v ~ 'private equity|\mpe\M|buy.?out|growth equity' then array['Private Equity', case when v ~ 'growth' then 'Growth equity' when v ~ 'buy.?out' then 'Buyout' end]
    when v ~ 'angel|individual|\mhnwi?\M|syndicate' then array['Angel', case when v ~ 'syndicate' then 'Syndicate' end]
    when v ~ 'corporate|\mcvc\M|strategic' then array['VC', 'Corporate VC']
    when v ~ 'accelerator|incubator|studio' then array['VC', 'Accelerator']
    when v ~ 'venture|\mvc\M|seed fund|micro.?vc' then array['VC', null]
    when v ~ 'sovereign|\mswf\M|government|state fund' then array['LP', 'Sovereign / Government']
    when v ~ 'pension' then array['LP', 'Pension']
    when v ~ 'endowment|foundation' then array['LP', 'Endowment / Foundation']
    when v ~ 'insur' then array['LP', 'Insurance']
    when v ~ 'consultan' then array['LP', 'Investment consultant']
    when v ~ 'asset manag' then array['LP', 'Asset manager']
    when v ~ '\mlps?\M|limited partner|institution' then array['LP', null]
    when v ~ 'bank|debt|lend|credit' then array['Other', 'Bank / Debt']
    else array['Other', raw] end
  from x;
$$;

create or replace function public.investors_set_type() returns trigger
language plpgsql set search_path = public as $$
declare c text[];
begin
  -- any label outside the eight categories is mapped (also when re-saved unchanged, e.g. during conversion)
  c := investor_type_classify(new.investor_type);
  if c[1] is not null and c[1] is distinct from new.investor_type then
    new.investor_subtype := coalesce(new.investor_subtype, c[2]);
    new.type_needs_review := new.type_needs_review or lower(trim(new.investor_type)) = 'lp / fund of funds';
    new.investor_type := c[1];
  end if;
  if tg_op = 'INSERT' or new.investor_type is distinct from old.investor_type then
    if new.investor_type is null then new.type_source := null;
    elsif new.type_source is null or (tg_op = 'UPDATE' and new.type_source is not distinct from old.type_source and old.investor_type is not null) then
      new.type_source := case when tg_op = 'INSERT' then 'stated' else 'manual' end;
    end if;
    if tg_op = 'UPDATE' and new.type_source = 'manual' then new.type_needs_review := false; end if;
  end if;
  return new;
end $$;
drop trigger if exists investors_type on public.investors;
create trigger investors_type before insert or update of investor_type on public.investors
  for each row execute function public.investors_set_type();

-- ── convert existing rows ──────────────────────────────────────────────────
-- 1) generic mapping of the old labels (Corporate VC → VC / Corporate VC, LP / Fund of Funds → LP + review, …)
update public.investors set type_source = 'stated', investor_type = investor_type where investor_type is not null;

-- 2) firm-specific corrections (known firms; type_source = inferred)
create temp table _cat(pat text, cat text, sub text, review boolean) on commit drop;
insert into _cat values
 -- funds of funds / secondaries
 ('^747 capital','Fund of Funds',null,false), ('^asia alternatives','Fund of Funds',null,false), ('^bay hills capital','Fund of Funds',null,false),
 ('^cendana capital','Fund of Funds',null,false), ('^columbia partners private capital','Fund of Funds',null,false), ('^fairview capital','Fund of Funds',null,false),
 ('^gcm grosvenor','Fund of Funds','Alternative asset manager',false), ('^harbourvest','Fund of Funds','Secondaries',false), ('^horsley bridge','Fund of Funds',null,false),
 ('^hq capital','Fund of Funds',null,false), ('^hypernova capital','Fund of Funds',null,false), ('^knightsbridge advisers','Fund of Funds',null,false),
 ('^lgt capital partners','Fund of Funds',null,false), ('^northgate capital','Fund of Funds',null,false), ('^paul capital','Fund of Funds','Secondaries',false),
 ('^recast capital','Fund of Funds',null,false), ('^top tier capital','Fund of Funds',null,false), ('^truebridge capital','Fund of Funds',null,false),
 ('^vista ridge capital','Fund of Funds',null,false), ('^mesirow','Fund of Funds','Asset manager',false), ('^amphibian capital','Fund of Funds','Fund of hedge funds',false),
 ('^vault fund','Fund of Funds',null,true), ('^gree lp fund','Fund of Funds',null,true), ('^first close partners','Fund of Funds',null,true),
 ('^fairway capital management','Fund of Funds',null,true), ('^foundry group','Fund of Funds','Also invests directly (VC)',true),
 -- LPs: asset managers, consultants, banks, endowments
 ('^american beacon','LP','Asset manager',false), ('^demarche associates','LP','Investment consultant',false), ('^dupont capital management','LP','Pension',false),
 ('^goldman sachs','LP','Bank / Asset manager',false), ('^wilshire','LP','Investment consultant',false), ('^mercer$','LP','Investment consultant',false),
 ('^trinitywallstreet$','LP','Endowment / Foundation',false), ('^lion cao asset management','LP','Asset manager',true),
 -- wealth managers serving families
 ('^the glenmede trust','Multi-Family Office','Wealth manager',false), ('^cerity partners','Multi-Family Office','Wealth manager',false),
 ('^method advisors','Multi-Family Office','Wealth manager',true), ('^alexbrown$','Multi-Family Office','Wealth manager',true),
 -- venture
 ('^morgan creek digital','VC','Digital assets',false), ('^galaxy$','VC','Digital assets',true), ('^thirdpointventures$','VC',null,false),
 ('^eightroads$','VC',null,false), ('^stripes$','Private Equity','Growth equity',true), ('^zubrcapital$','Private Equity',null,false),
 -- banks
 ('^raiffeisen bank','Other','Bank / Debt',false);
update public.investors i set investor_type = c.cat, investor_subtype = coalesce(c.sub, i.investor_subtype), type_source = 'inferred', type_needs_review = c.review
from _cat c where lower(coalesce(i.organization, '')) ~ c.pat;

-- 3) the remaining old "LP / Fund of Funds" firms not identified above stay LP, flagged for review (already set)

alter table public.investors drop constraint if exists investors_type_check;
alter table public.investors add constraint investors_type_check check (investor_type is null or investor_type in
  ('VC','Angel','Family Office','Multi-Family Office','Private Equity','Hedge Fund','Fund of Funds','LP','Other'));
create index if not exists investors_type_idx on public.investors (investor_type);
