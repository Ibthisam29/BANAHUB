-- 20 · Fundraising company categories (capital raises = deal_rooms)
-- Categorise every company raising by: industry (from sectors via industry_taxonomy, existing trigger),
-- current stage / round, rounds raised to date, current raise size, preferred investment instruments.

alter table public.deal_rooms
  add column if not exists preferred_instruments text[]  not null default '{}',  -- e.g. {Equity, Convertible note, SAFE}
  add column if not exists prior_rounds          jsonb   not null default '[]',  -- [{round, amount, currency, date, lead}]
  add column if not exists rounds_raised         int     not null default 0,     -- derived from prior_rounds unless set manually
  add column if not exists total_raised_to_date  numeric,                        -- in the raise currency
  add column if not exists last_round            text,
  add column if not exists last_round_date       date,
  add column if not exists pre_money_valuation   numeric,
  add column if not exists raise_band            text,                           -- derived from target_raise (USD-equivalent)
  add column if not exists rounds_band           text;                           -- derived: First raise · 1 prior round · 2 prior rounds · 3+ prior rounds

create index if not exists deal_rooms_pref_instr_gin on public.deal_rooms using gin (preferred_instruments);
create index if not exists deal_rooms_industries_gin on public.deal_rooms using gin (industries);
create index if not exists deal_rooms_categories on public.deal_rooms (stage, raise_band, rounds_band);

create or replace function public.os_raise_band(amount numeric, cur text) returns text
language sql immutable as $$
  select case
    when amount is null or amount <= 0 then null
    when public.os_to_usd(amount, cur) < 250000   then 'Under US$250k'
    when public.os_to_usd(amount, cur) < 1000000  then 'US$250k–1M'
    when public.os_to_usd(amount, cur) < 3000000  then 'US$1–3M'
    when public.os_to_usd(amount, cur) < 10000000 then 'US$3–10M'
    when public.os_to_usd(amount, cur) < 25000000 then 'US$10–25M'
    else 'US$25M+' end;
$$;

create or replace function public.deal_rooms_classify() returns trigger
language plpgsql set search_path = public as $$
declare n int; tot numeric; lr record;
begin
  -- preferred instruments ↔ primary instrument (the matching engine scores on `instrument`)
  new.preferred_instruments := array(select v from (
      select (array_agg(trim(x) order by o))[1] v, min(o) o from unnest(coalesce(new.preferred_instruments, '{}')) with ordinality t(x, o)
       where trim(coalesce(x, '')) <> '' group by lower(trim(x))) s order by o);
  if tg_op = 'UPDATE' and new.instrument is distinct from old.instrument and new.preferred_instruments = coalesce(old.preferred_instruments, '{}') and new.instrument is not null then
    new.preferred_instruments := array_prepend(new.instrument, array_remove(new.preferred_instruments, new.instrument));
  elsif cardinality(new.preferred_instruments) = 0 and coalesce(new.instrument, new.investment_type) is not null then
    new.preferred_instruments := array[coalesce(new.instrument, new.investment_type)];
  end if;
  if cardinality(new.preferred_instruments) > 0 then
    new.instrument := new.preferred_instruments[1];
    new.investment_type := array_to_string(new.preferred_instruments, ', ');
  end if;

  -- funding history from prior_rounds
  if jsonb_typeof(new.prior_rounds) <> 'array' then new.prior_rounds := '[]'; end if;
  n := jsonb_array_length(new.prior_rounds);
  if n > 0 then
    select sum(nullif(r->>'amount', '')::numeric) into tot from jsonb_array_elements(new.prior_rounds) r;
    select r->>'round' as round, nullif(r->>'date', '')::date as d into lr
      from jsonb_array_elements(new.prior_rounds) r order by nullif(r->>'date', '')::date desc nulls last limit 1;
    new.rounds_raised := n;
    new.total_raised_to_date := tot;
    new.last_round := lr.round;
    new.last_round_date := lr.d;
  end if;
  new.rounds_band := case when coalesce(new.rounds_raised, 0) <= 0 then 'First raise'
                          when new.rounds_raised = 1 then '1 prior round'
                          when new.rounds_raised = 2 then '2 prior rounds'
                          else '3+ prior rounds' end;
  new.raise_band := public.os_raise_band(new.target_raise, new.currency);
  return new;
end $$;
drop trigger if exists deal_rooms_classify on public.deal_rooms;
create trigger deal_rooms_classify before insert or update on public.deal_rooms
  for each row execute function public.deal_rooms_classify();

-- backfill existing rows
update public.deal_rooms set updated_at = coalesce(updated_at, now());
