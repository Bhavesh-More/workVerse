-- 0008: Which of the company's judges take part in a topic's scenario.
-- NULL = all of them (judges added later join automatically); otherwise a list of roster judge ids.
-- Per-judge topic tuning stays in company_topics.judges, keyed by roster judge id. Additive.
alter table public.company_topics add column if not exists judge_ids jsonb;
