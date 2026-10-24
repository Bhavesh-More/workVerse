-- 0004: Learner context builder
-- Profile links (GitHub, LinkedIn, portfolio) and a free-text situation the learner wants to
-- practise, plus one learner_contexts row per profile holding the scraped sources, the
-- LLM-built context and the personalised scenario plan. Additive and safe to re-run.
--
-- Only extracted CV text is stored, never the uploaded file.

begin;

alter table public.profiles
  add column if not exists github_url text check (github_url is null or char_length(github_url) <= 300),
  add column if not exists linkedin_url text check (linkedin_url is null or char_length(linkedin_url) <= 300),
  add column if not exists portfolio_url text check (portfolio_url is null or char_length(portfolio_url) <= 300),
  add column if not exists custom_situation text check (custom_situation is null or char_length(custom_situation) <= 1000);

create table if not exists public.learner_contexts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  -- {"cv": {...}, "github": {...}, "linkedin": {...}, "portfolio": {...}}; each source keeps
  -- the url/file it came from, when it was fetched, ok/error and the extracted text/data.
  sources jsonb not null default '{}'::jsonb check (jsonb_typeof(sources) = 'object'),
  context jsonb check (context is null or jsonb_typeof(context) = 'object'),
  scenario_plan jsonb check (scenario_plan is null or jsonb_typeof(scenario_plan) = 'object'),
  -- Hash of everything the context was built from; a different hash means it is stale.
  source_hash text check (source_hash is null or char_length(source_hash) <= 80),
  builder text check (builder is null or char_length(builder) <= 80),
  built_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists learner_contexts_set_updated_at on public.learner_contexts;
create trigger learner_contexts_set_updated_at
before update on public.learner_contexts
for each row execute function public.set_updated_at();

alter table public.learner_contexts enable row level security;

commit;
