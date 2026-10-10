-- WorkVerse AI initial Supabase/PostgreSQL schema.
-- Review this schema before applying it to a shared/production project.
-- Apply through a versioned Supabase migration in real development; keep this file as a reference snapshot.
-- The app uses Supabase Auth for identity, FastAPI for app writes, Postgres for durable state,
-- and private S3-compatible object storage for file bytes.
--
-- Security note: RLS policies below protect access through Supabase's Data API when requests carry
-- a Supabase Auth JWT. A privileged direct PostgreSQL role can bypass RLS. FastAPI MUST perform
-- owner checks for every resource, and production should use a restricted runtime DB role where
-- feasible. Test the actual role/policies rather than assuming RLS automatically protects direct SQL.

begin;

create extension if not exists pgcrypto;

-- ---------- Shared triggers ----------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- User profile ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 120),
  education_summary text check (education_summary is null or char_length(education_summary) <= 3000),
  experience_summary text check (experience_summary is null or char_length(experience_summary) <= 5000),
  target_role text check (target_role is null or char_length(target_role) <= 160),
  career_goals text[] not null default '{}',
  preferred_stack text[] not null default '{}',
  experience_level text check (
    experience_level is null or experience_level in ('beginner', 'early_career', 'intermediate', 'experienced', 'unspecified')
  ),
  personalization_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Supabase Auth user creation may create an empty profile automatically.
-- Any submitted metadata is untrusted, user-editable profile data, not authorization metadata.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_workverse on auth.users;
create trigger on_auth_user_created_workverse
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create table if not exists public.profile_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  level_self_reported text check (level_self_reported is null or level_self_reported in ('beginner', 'basic', 'intermediate', 'advanced', 'unspecified')),
  provenance text not null default 'self_reported' check (provenance in ('self_reported', 'document_extracted', 'user_confirmed', 'demonstrated')),
  source_document_id uuid,
  source_task_id uuid,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name),
  check ((provenance <> 'demonstrated') or source_task_id is not null)
);

drop trigger if exists profile_skills_set_updated_at on public.profile_skills;
create trigger profile_skills_set_updated_at
before update on public.profile_skills
for each row execute function public.set_updated_at();

-- ---------- Documents (metadata only; file bytes are stored in private object storage) ----------

create table if not exists public.user_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('resume', 'portfolio', 'job_description', 'technical_reference', 'task_submission', 'other')),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  content_type text not null check (char_length(content_type) <= 160),
  size_bytes bigint not null check (size_bytes > 0),
  storage_provider text not null default 'minio' check (storage_provider in ('minio', 's3_compatible')),
  bucket_name text not null,
  object_key text not null unique,
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[a-fA-F0-9]{64}$'),
  status text not null default 'upload_pending' check (status in ('upload_pending', 'uploaded', 'processing', 'ready', 'failed', 'deletion_pending', 'deleted')),
  extraction_version text,
  extracted_facts jsonb not null default '[]'::jsonb check (jsonb_typeof(extracted_facts) = 'array'),
  processing_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists user_documents_user_created_idx on public.user_documents (user_id, created_at desc);
create index if not exists user_documents_status_idx on public.user_documents (status) where status not in ('ready', 'deleted');

drop trigger if exists user_documents_set_updated_at on public.user_documents;
create trigger user_documents_set_updated_at
before update on public.user_documents
for each row execute function public.set_updated_at();

-- Add provenance foreign key after user_documents exists.
alter table public.profile_skills
  drop constraint if exists profile_skills_source_document_id_fkey;
alter table public.profile_skills
  add constraint profile_skills_source_document_id_fkey
  foreign key (source_document_id) references public.user_documents(id) on delete set null;

-- ---------- Scenario template families and immutable scenario instances/versions ----------

create table if not exists public.scenario_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 160),
  summary text not null check (char_length(summary) <= 2000),
  categories text[] not null default '{}',
  target_roles text[] not null default '{}',
  supported_modes text[] not null default array['quick']::text[],
  estimated_minutes integer not null default 10 check (estimated_minutes between 1 and 480),
  is_published boolean not null default false,
  template_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(template_definition) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists scenario_templates_set_updated_at on public.scenario_templates;
create trigger scenario_templates_set_updated_at
before update on public.scenario_templates
for each row execute function public.set_updated_at();

-- A scenario_version is an immutable validated generated instance, not a mutable template.
-- Store only the minimum user-profile snapshot necessary for the run.
create table if not exists public.scenario_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.scenario_templates(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'validating', 'validated', 'published', 'rejected')),
  difficulty text not null check (difficulty in ('introductory', 'standard', 'challenging')),
  mode text not null check (mode in ('quick', 'project')),
  variation_seed text not null,
  blueprint jsonb not null check (jsonb_typeof(blueprint) = 'object'),
  rubric_snapshot jsonb not null check (jsonb_typeof(rubric_snapshot) = 'object'),
  profile_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(profile_snapshot) = 'object'),
  validation_report jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_report) = 'object'),
  generator_provider text,
  generator_model text,
  prompt_version text,
  validator_version text not null,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  published_at timestamptz,
  check ((status not in ('validated', 'published')) or validated_at is not null)
);

create index if not exists scenario_versions_template_created_idx on public.scenario_versions (template_id, created_at desc);
create index if not exists scenario_versions_owner_created_idx on public.scenario_versions (created_by, created_at desc);
create index if not exists scenario_versions_published_idx on public.scenario_versions (template_id, difficulty) where is_published = true;

-- Prevent mutation of a validated scenario version by application-level policy. For stronger DB
-- enforcement, revoke UPDATE/DELETE on validated rows from the runtime role; migrations/admin role
-- manages template/schema changes. Version immutability should be tested in service code as well.

-- ---------- Sessions: authoritative current snapshot plus event history ----------

create table if not exists public.simulation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scenario_version_id uuid not null references public.scenario_versions(id) on delete restrict,
  mode text not null check (mode in ('quick', 'project')),
  status text not null default 'created' check (status in ('created', 'active', 'processing', 'completed', 'abandoned', 'failed')),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  state_version bigint not null default 1 check (state_version > 0),
  active_turn_id uuid,
  processing_started_at timestamptz,
  client_create_key text,
  started_at timestamptz,
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'completed' and ended_at is not null) or status <> 'completed')
);

create unique index if not exists simulation_sessions_user_create_key_idx
  on public.simulation_sessions(user_id, client_create_key)
  where client_create_key is not null;
create index if not exists simulation_sessions_user_created_idx on public.simulation_sessions (user_id, created_at desc);
create index if not exists simulation_sessions_status_activity_idx on public.simulation_sessions (status, last_activity_at desc);

drop trigger if exists simulation_sessions_set_updated_at on public.simulation_sessions;
create trigger simulation_sessions_set_updated_at
before update on public.simulation_sessions
for each row execute function public.set_updated_at();

create table if not exists public.simulation_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.simulation_sessions(id) on delete cascade,
  sequence_number bigint not null check (sequence_number > 0),
  event_type text not null check (char_length(event_type) between 1 and 120),
  actor_type text not null check (actor_type in ('learner', 'character', 'system')),
  actor_id text,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  state_version_after bigint not null check (state_version_after > 0),
  created_at timestamptz not null default now(),
  unique (session_id, sequence_number),
  unique (session_id, idempotency_key)
);

create index if not exists simulation_events_session_sequence_idx on public.simulation_events (session_id, sequence_number);
create index if not exists simulation_events_type_created_idx on public.simulation_events (event_type, created_at desc);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.simulation_sessions(id) on delete cascade,
  sequence_number bigint not null check (sequence_number > 0),
  turn_id uuid,
  client_turn_id uuid,
  speaker_type text not null check (speaker_type in ('learner', 'character', 'system')),
  character_id text,
  content text not null check (char_length(content) <= 50000),
  modality text not null default 'text' check (modality in ('text', 'voice_transcript', 'system_event')),
  status text not null default 'completed' check (status in ('completed', 'failed', 'redacted')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (session_id, sequence_number),
  unique (session_id, client_turn_id),
  check ((speaker_type <> 'character') or character_id is not null)
);

create index if not exists conversation_messages_session_sequence_idx on public.conversation_messages (session_id, sequence_number);
create index if not exists conversation_messages_session_turn_idx on public.conversation_messages (session_id, turn_id);

-- ---------- Task deliverables ----------

create table if not exists public.task_deliverables (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.simulation_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id text not null check (char_length(task_id) between 1 and 160),
  document_id uuid references public.user_documents(id) on delete set null,
  inline_text text check (inline_text is null or char_length(inline_text) <= 100000),
  result_status text not null default 'submitted' check (result_status in ('draft', 'submitted', 'validated', 'rejected')),
  result_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(result_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((document_id is not null) or (inline_text is not null))
);

create index if not exists task_deliverables_session_created_idx on public.task_deliverables (session_id, created_at);
create index if not exists task_deliverables_user_created_idx on public.task_deliverables (user_id, created_at desc);

drop trigger if exists task_deliverables_set_updated_at on public.task_deliverables;
create trigger task_deliverables_set_updated_at
before update on public.task_deliverables
for each row execute function public.set_updated_at();

-- Ensure a deliverable belongs to the same user who owns its session and attached document.
create or replace function public.validate_workverse_deliverable_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session_user_id uuid;
  v_document_user_id uuid;
begin
  select user_id into v_session_user_id
  from public.simulation_sessions where id = new.session_id;
  if v_session_user_id is null or v_session_user_id <> new.user_id then
    raise exception 'deliverable user must own the referenced session';
  end if;

  if new.document_id is not null then
    select user_id into v_document_user_id
    from public.user_documents where id = new.document_id;
    if v_document_user_id is null or v_document_user_id <> new.user_id then
      raise exception 'deliverable document must belong to the same user';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists task_deliverables_validate_scope on public.task_deliverables;
create trigger task_deliverables_validate_scope
before insert or update on public.task_deliverables
for each row execute function public.validate_workverse_deliverable_scope();

alter table public.profile_skills
  drop constraint if exists profile_skills_source_task_id_fkey;
alter table public.profile_skills
  add constraint profile_skills_source_task_id_fkey
  foreign key (source_task_id) references public.task_deliverables(id) on delete cascade;

-- Prevent attaching another user's document or deliverable as profile-skill provenance.
create or replace function public.validate_workverse_skill_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_source_user_id uuid;
begin
  if new.source_document_id is not null then
    select user_id into v_source_user_id from public.user_documents where id = new.source_document_id;
    if v_source_user_id is null or v_source_user_id <> new.user_id then
      raise exception 'skill source document must belong to the same user';
    end if;
  end if;
  if new.source_task_id is not null then
    select user_id into v_source_user_id from public.task_deliverables where id = new.source_task_id;
    if v_source_user_id is null or v_source_user_id <> new.user_id then
      raise exception 'skill source deliverable must belong to the same user';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profile_skills_validate_provenance on public.profile_skills;
create trigger profile_skills_validate_provenance
before insert or update on public.profile_skills
for each row execute function public.validate_workverse_skill_provenance();

-- ---------- Evaluation reports ----------

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.simulation_sessions(id) on delete cascade,
  evaluation_version integer not null default 1 check (evaluation_version > 0),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'needs_review')),
  rubric_version text not null,
  evaluator_version text not null,
  model_provider text,
  model_name text,
  overall_score numeric(5,2) check (overall_score is null or overall_score between 0 and 100),
  report_summary text check (report_summary is null or char_length(report_summary) <= 10000),
  limitations jsonb not null default '[]'::jsonb check (jsonb_typeof(limitations) = 'array'),
  validation_warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_warnings) = 'array'),
  report_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(report_metadata) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, evaluation_version),
  check ((status <> 'completed') or completed_at is not null)
);

create index if not exists evaluations_session_created_idx on public.evaluations (session_id, created_at desc);

create table if not exists public.evaluation_items (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  criterion_id text not null check (char_length(criterion_id) between 1 and 160),
  criterion_name text not null check (char_length(criterion_name) between 1 and 200),
  status text not null check (status in ('scored', 'insufficient_evidence', 'needs_review')),
  score integer,
  score_max integer not null default 4 check (score_max between 1 and 100),
  explanation text not null check (char_length(explanation) <= 10000),
  recommendation text not null check (char_length(recommendation) <= 10000),
  counterevidence jsonb not null default '[]'::jsonb check (jsonb_typeof(counterevidence) = 'array'),
  created_at timestamptz not null default now(),
  unique (evaluation_id, criterion_id),
  check (
    (status = 'scored' and score is not null and score between 0 and score_max)
    or (status in ('insufficient_evidence', 'needs_review') and score is null)
  )
);

create table if not exists public.evaluation_evidence (
  id uuid primary key default gen_random_uuid(),
  evaluation_item_id uuid not null references public.evaluation_items(id) on delete cascade,
  source_type text not null check (source_type in ('message', 'event', 'deliverable')),
  message_id uuid references public.conversation_messages(id) on delete cascade,
  event_id uuid references public.simulation_events(id) on delete cascade,
  deliverable_id uuid references public.task_deliverables(id) on delete cascade,
  quote text check (quote is null or char_length(quote) between 1 and 10000),
  interpretation text not null check (char_length(interpretation) <= 10000),
  created_at timestamptz not null default now(),
  check (
    (source_type = 'message' and message_id is not null and event_id is null and deliverable_id is null)
    or (source_type = 'event' and event_id is not null and message_id is null and deliverable_id is null)
    or (source_type = 'deliverable' and deliverable_id is not null and message_id is null and event_id is null)
  )
);

create index if not exists evaluation_items_evaluation_idx on public.evaluation_items (evaluation_id);
create index if not exists evaluation_evidence_item_idx on public.evaluation_evidence (evaluation_item_id);

-- Cross-table evidence guard: the evidence source must belong to the evaluated session;
-- a quote from a message/deliverable must match its saved text. API code should validate too.
create or replace function public.validate_workverse_evaluation_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_source_session_id uuid;
  v_source_text text;
  v_evaluation_id uuid;
begin
  select ev.session_id into v_session_id
  from public.evaluation_items ei
  join public.evaluations ev on ev.id = ei.evaluation_id
  where ei.id = new.evaluation_item_id;

  if v_session_id is null then
    raise exception 'evaluation item not found';
  end if;

  if new.source_type = 'message' then
    select session_id, content into v_source_session_id, v_source_text
    from public.conversation_messages where id = new.message_id;
  elsif new.source_type = 'event' then
    select session_id, payload::text into v_source_session_id, v_source_text
    from public.simulation_events where id = new.event_id;
  elsif new.source_type = 'deliverable' then
    select session_id, inline_text into v_source_session_id, v_source_text
    from public.task_deliverables where id = new.deliverable_id;
  end if;

  if v_source_session_id is null or v_source_session_id <> v_session_id then
    raise exception 'evidence source does not belong to evaluated session';
  end if;

  if new.quote is not null then
    if v_source_text is null or position(new.quote in v_source_text) = 0 then
      raise exception 'evidence quote does not match persisted source text';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists evaluation_evidence_validate on public.evaluation_evidence;
create trigger evaluation_evidence_validate
before insert or update on public.evaluation_evidence
for each row execute function public.validate_workverse_evaluation_evidence();

-- ---------- Optional progress aggregate ----------
-- Progress is a derived summary; raw evaluation_items remain the source of evidence.
create table if not exists public.skill_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  competency_id text not null check (char_length(competency_id) between 1 and 160),
  compatible_rubric_family text not null check (char_length(compatible_rubric_family) <= 160),
  attempts_count integer not null default 0 check (attempts_count >= 0),
  scored_attempts_count integer not null default 0 check (scored_attempts_count >= 0 and scored_attempts_count <= attempts_count),
  average_normalized_score numeric(5,2) check (average_normalized_score is null or average_normalized_score between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, competency_id, compatible_rubric_family)
);

-- ---------- Row Level Security ----------
-- These policies are designed for user-context requests via the Supabase Data API.
-- FastAPI must separately enforce owner checks. A privileged server DB role may bypass policies.

alter table public.profiles enable row level security;
alter table public.profile_skills enable row level security;
alter table public.user_documents enable row level security;
alter table public.scenario_templates enable row level security;
alter table public.scenario_versions enable row level security;
alter table public.simulation_sessions enable row level security;
alter table public.simulation_events enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.task_deliverables enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_items enable row level security;
alter table public.evaluation_evidence enable row level security;
alter table public.skill_progress enable row level security;

-- Policies are read-only for app tables because product mutations go through FastAPI.
-- If direct frontend writes are intentionally introduced later, design and test operation-specific policies.

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists profile_skills_select_own on public.profile_skills;
create policy profile_skills_select_own on public.profile_skills for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists user_documents_select_own on public.user_documents;
create policy user_documents_select_own on public.user_documents for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists scenario_templates_select_published on public.scenario_templates;
create policy scenario_templates_select_published on public.scenario_templates for select to authenticated
using (is_published = true);

drop policy if exists scenario_versions_select_available on public.scenario_versions;
create policy scenario_versions_select_available on public.scenario_versions for select to authenticated
using (is_published = true or created_by = (select auth.uid()));

drop policy if exists simulation_sessions_select_own on public.simulation_sessions;
create policy simulation_sessions_select_own on public.simulation_sessions for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists simulation_events_select_session_owner on public.simulation_events;
create policy simulation_events_select_session_owner on public.simulation_events for select to authenticated
using (exists (
  select 1 from public.simulation_sessions s
  where s.id = simulation_events.session_id and s.user_id = (select auth.uid())
));

drop policy if exists conversation_messages_select_session_owner on public.conversation_messages;
create policy conversation_messages_select_session_owner on public.conversation_messages for select to authenticated
using (exists (
  select 1 from public.simulation_sessions s
  where s.id = conversation_messages.session_id and s.user_id = (select auth.uid())
));

drop policy if exists task_deliverables_select_own on public.task_deliverables;
create policy task_deliverables_select_own on public.task_deliverables for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists evaluations_select_session_owner on public.evaluations;
create policy evaluations_select_session_owner on public.evaluations for select to authenticated
using (exists (
  select 1 from public.simulation_sessions s
  where s.id = evaluations.session_id and s.user_id = (select auth.uid())
));

drop policy if exists evaluation_items_select_session_owner on public.evaluation_items;
create policy evaluation_items_select_session_owner on public.evaluation_items for select to authenticated
using (exists (
  select 1
  from public.evaluations ev
  join public.simulation_sessions s on s.id = ev.session_id
  where ev.id = evaluation_items.evaluation_id and s.user_id = (select auth.uid())
));

drop policy if exists evaluation_evidence_select_session_owner on public.evaluation_evidence;
create policy evaluation_evidence_select_session_owner on public.evaluation_evidence for select to authenticated
using (exists (
  select 1
  from public.evaluation_items ei
  join public.evaluations ev on ev.id = ei.evaluation_id
  join public.simulation_sessions s on s.id = ev.session_id
  where ei.id = evaluation_evidence.evaluation_item_id and s.user_id = (select auth.uid())
));

drop policy if exists skill_progress_select_own on public.skill_progress;
create policy skill_progress_select_own on public.skill_progress for select to authenticated
using ((select auth.uid()) = user_id);

-- Avoid a permissive anonymous policy. Also review GRANTs in the Supabase project.
-- RLS alone is not sufficient if data is accessible by another privileged route.

commit;

-- Recommended follow-up before production:
-- 1. Add Supabase database tests (supabase test db) that assert SELECT/INSERT/UPDATE/DELETE deny/allow cases.
-- 2. Decide on runtime DB role and prove whether it bypasses RLS. Do not assume the postgres owner role is restricted.
-- 3. Add a migration that revokes unnecessary table privileges from anon/authenticated roles and grants only intended reads.
-- 4. Add an immutable-version trigger or runtime-role grants preventing updates/deletes to validated scenario_versions.
-- 5. Review retention/deletion policy and whether completed session evidence should be anonymized or cascade-deleted.
