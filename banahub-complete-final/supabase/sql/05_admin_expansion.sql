-- User block/unblock
alter table users add column if not exists blocked boolean default false;
alter table users add column if not exists blocked_at timestamptz;
alter table users add column if not exists blocked_reason text;

-- Network directory: LinkedIn + searchable fields
alter table investors add column if not exists linkedin_url text;
alter table investors add column if not exists full_name text;
alter table investors add column if not exists email text;
alter table investors add column if not exists organization text;
alter table investors add column if not exists check_size text;
alter table investors add column if not exists geography text;

alter table companies add column if not exists linkedin_url text;
alter table companies add column if not exists contact_name text;
alter table companies add column if not exists email text;
alter table companies add column if not exists website text;
alter table companies add column if not exists description text;

-- Deal Room / Strategy planner fields
alter table deal_rooms add column if not exists name text;
alter table deal_rooms add column if not exists industry text;
alter table deal_rooms add column if not exists investment_type text;   -- equity, debt, convertible, SAFE, etc.
alter table deal_rooms add column if not exists target_raise numeric;
alter table deal_rooms add column if not exists currency text default 'USD';
alter table deal_rooms add column if not exists stage text;             -- pre-seed, seed, series A, etc.
alter table deal_rooms add column if not exists notes text;

-- Event video support
alter table events add column if not exists video_url text;



