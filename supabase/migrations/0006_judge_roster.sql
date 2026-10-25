-- A company's own AI judges: an ordered list of 1..12 judges, each playing one of the scenario's
-- five roles with its own name, avatar, voice and personality. NULL keeps the legacy five-role
-- cast (names from the existing cast, tuned through judge_defaults).
alter table public.companies add column if not exists judge_roster jsonb;
