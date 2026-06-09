-- User feedback on nudge responses: true = helpful, false = unhelpful, null = no feedback
alter table public.nudges add column if not exists helpful boolean default null;
alter table public.nudges add column if not exists flagged boolean default false;
