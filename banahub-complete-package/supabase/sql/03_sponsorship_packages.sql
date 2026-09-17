-- Sponsorship Packages — added on top of base_schema.sql + security_hardening.sql
-- Run in Supabase SQL editor after those two.

create table if not exists sponsorship_packages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,  -- nullable: null = standing/general sponsorship, not tied to one event
  name text not null,
  format text not null default 'virtual',      -- 'virtual' | 'in_person'
  category text not null default 'general',    -- 'general' | 'speaking' | 'booth'
  description text,
  inclusions text[],                            -- bullet list of what's included
  price_amount numeric not null default 0,
  currency text default 'USD',
  max_slots int,                                 -- optional cap (e.g. only 3 speaking slots)
  slots_taken int default 0,
  published boolean default true,
  created_at timestamptz default now()
);
alter table sponsorship_packages enable row level security;

create policy "sponsorship_packages_public_read" on sponsorship_packages
  for select using (published = true);

create policy "sponsorship_packages_admin_all" on sponsorship_packages
  for all using (
    exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
  );

-- Seed: the two sponsorship tracks requested, each with speaking + booth
-- variants where it makes sense (booth only applies in-person).
-- Edit prices in Admin → Sponsorship after this runs — placeholders below.
insert into sponsorship_packages (name, format, category, description, inclusions, price_amount, currency, published)
values
  ('Virtual Event Sponsorship', 'virtual', 'general',
   'Brand visibility and audience access across a virtual event — logo placement, mention in opening remarks, and post-event attendee report.',
   array['Logo on virtual event platform', 'Mention in opening remarks', 'Post-event attendee report', 'Social media shoutout'],
   0, 'USD', false),

  ('Virtual Speaking Slot', 'virtual', 'speaking',
   'A dedicated speaking slot within the virtual programme — present directly to the attending audience.',
   array['10-minute speaking slot', 'Q&A session', 'Session recording rights', 'Everything in Virtual Event Sponsorship'],
   0, 'USD', false),

  ('In-Person Sponsorship', 'in_person', 'general',
   'On-the-ground brand presence at the physical event — signage, materials placement, and attendee list access.',
   array['Event signage placement', 'Materials in delegate bags', 'Attendee list (opt-in)', 'Logo on event backdrop'],
   0, 'USD', false),

  ('In-Person Speaking Slot', 'in_person', 'speaking',
   'A speaking slot on the main stage or a breakout session at the physical event.',
   array['Stage or breakout speaking slot', 'Speaker bio in programme', 'Professional photography', 'Everything in In-Person Sponsorship'],
   0, 'USD', false),

  ('In-Person Booth', 'in_person', 'booth',
   'A dedicated booth space at the physical event for direct attendee engagement.',
   array['Booth space (table + 2 chairs)', 'Listed on event floor plan', 'Two staff passes', 'Everything in In-Person Sponsorship'],
   0, 'USD', false);

-- These 5 rows are seeded as UNPUBLISHED (published = false) with $0
-- placeholder pricing on purpose — real prices need to be set before
-- they go live. Set prices + flip published = true in Admin →
-- Sponsorship, or run:
--   update sponsorship_packages set price_amount = 2500, published = true where name = 'Virtual Event Sponsorship';
