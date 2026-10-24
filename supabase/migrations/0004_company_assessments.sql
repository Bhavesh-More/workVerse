-- 0004: Company accounts, assessment topics, judge personalities and candidate invites
-- A company is owned by one profile (the Clerk user who created it). Companies author topics
-- (a scenario brief plus per-judge personality overrides), create assessments from a topic and
-- invite candidates by email. A candidate's run is an ordinary simulation session linked back to
-- the invite, so the company reads the same evaluation the candidate sees. Additive, re-runnable.

begin;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  -- {host, port, username, password, from_email, from_name, security: "starttls"|"ssl"|"none"}
  smtp jsonb not null default '{}'::jsonb check (jsonb_typeof(smtp) = 'object'),
  -- Company-wide judge personality defaults, keyed by judge slot (manager, teammate, ...).
  judge_defaults jsonb not null default '{}'::jsonb check (jsonb_typeof(judge_defaults) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists companies_owner_idx on public.companies (owner_profile_id);

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create table if not exists public.company_topics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  track text not null default 'backend' check (track in ('backend', 'frontend', 'data', 'product')),
  incident text check (incident is null or char_length(incident) <= 40),
  difficulty text not null default 'standard' check (difficulty in ('introductory', 'standard', 'challenging')),
  -- Per-topic judge overrides on top of the company defaults, keyed by judge slot.
  judges jsonb not null default '{}'::jsonb check (jsonb_typeof(judges) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists company_topics_company_idx on public.company_topics (company_id, created_at desc);

drop trigger if exists company_topics_set_updated_at on public.company_topics;
create trigger company_topics_set_updated_at
before update on public.company_topics
for each row execute function public.set_updated_at();

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  topic_id uuid not null references public.company_topics(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 160),
  message text not null default '' check (char_length(message) <= 2000),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assessments_company_idx on public.assessments (company_id, created_at desc);

drop trigger if exists assessments_set_updated_at on public.assessments;
create trigger assessments_set_updated_at
before update on public.assessments
for each row execute function public.set_updated_at();

create table if not exists public.assessment_invites (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  candidate_name text check (candidate_name is null or char_length(candidate_name) <= 120),
  token text not null unique check (char_length(token) between 16 and 128),
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  email_error text check (email_error is null or char_length(email_error) <= 1000),
  sent_at timestamptz,
  opened_at timestamptz,
  profile_id uuid references public.profiles(id) on delete set null,
  session_id uuid references public.simulation_sessions(id) on delete set null,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, email)
);
create index if not exists assessment_invites_assessment_idx on public.assessment_invites (assessment_id, created_at);
create index if not exists assessment_invites_session_idx on public.assessment_invites (session_id) where session_id is not null;

drop trigger if exists assessment_invites_set_updated_at on public.assessment_invites;
create trigger assessment_invites_set_updated_at
before update on public.assessment_invites
for each row execute function public.set_updated_at();

-- Only the API (privileged role) touches these; no Data API access.
alter table public.companies enable row level security;
alter table public.company_topics enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_invites enable row level security;

commit;
