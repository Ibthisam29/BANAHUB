-- 25 · Paid capital-raise campaign
-- Entering a capital raise is free. Running an investor campaign is a paid BANAHUB service, available once the raise is accepted.
-- Price lives in pricing_catalog (_seed_key 'capital_campaign', editable in Admin OS → Pricing). Starts inactive until a price is set.

alter table public.deal_rooms
  add column if not exists campaign_status   text check (campaign_status in ('awaiting_payment','paid','active','completed','cancelled')),
  add column if not exists campaign_paid_at  timestamptz,
  add column if not exists campaign_amount   numeric,
  add column if not exists campaign_currency text,
  add column if not exists campaign_session  text;

insert into public.pricing_catalog (category, name, description, price_amount, currency, billing_cycle, active, sort_order, _seed_key)
select 'service', 'Capital Raise Campaign', 'BANAHUB-run investor outreach campaign for an accepted capital raise (matching, shortlist, managed outreach, follow-ups, reporting). No guarantee of investor interest or funding.', 0, 'SGD', 'one_time', false, 19, 'capital_campaign'
where not exists (select 1 from public.pricing_catalog where _seed_key = 'capital_campaign');

-- members can never set campaign fields themselves (payment is confirmed only by the Stripe webhook)
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
    new.os_owner_id := null; new.mandate_status := null; new.mandate_signed_at := null; new.probability := null; new.shortlist := null;
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
notify pgrst, 'reload schema';
