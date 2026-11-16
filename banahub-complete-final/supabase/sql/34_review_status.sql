-- 34 · Allow the review-queue statuses used by Admin OS / Ben (ben_review, approved, rejected) alongside member-submission statuses.
alter table public.investors drop constraint if exists investors_review_status_check;
alter table public.investors add constraint investors_review_status_check
  check (review_status is null or review_status = any (array['submitted','in_review','needs_info','accepted','declined','ben_review','approved','rejected']));
