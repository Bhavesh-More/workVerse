-- 0005: Company-built virtual workplaces
-- A company chooses the default office or a custom world (world_mode; null = not chosen yet).
-- The world-setup wizard's progress and the company's display-only team members live on the
-- company. Each company has one world row: a draft (autosaved by the editor, versioned so two
-- tabs can't silently overwrite each other) and the last published copy that candidates get.
-- Sessions snapshot the published world into their blueprint, so later edits never change a
-- run in progress. Additive, re-runnable.

begin;

alter table public.companies add column if not exists world_mode text;
alter table public.companies drop constraint if exists companies_world_mode_check;
alter table public.companies add constraint companies_world_mode_check
  check (world_mode is null or world_mode in ('default', 'custom'));
alter table public.companies add column if not exists world_setup jsonb not null default '{}'::jsonb;
alter table public.companies drop constraint if exists companies_world_setup_check;
alter table public.companies add constraint companies_world_setup_check check (jsonb_typeof(world_setup) = 'object');
alter table public.companies add column if not exists team_members jsonb not null default '[]'::jsonb;
alter table public.companies drop constraint if exists companies_team_members_check;
alter table public.companies add constraint companies_team_members_check check (jsonb_typeof(team_members) = 'array');

create table if not exists public.company_worlds (
  company_id uuid primary key references public.companies(id) on delete cascade,
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  draft_version integer not null default 1 check (draft_version > 0),
  published jsonb check (published is null or jsonb_typeof(published) = 'object'),
  published_version integer,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists company_worlds_set_updated_at on public.company_worlds;
create trigger company_worlds_set_updated_at
before update on public.company_worlds
for each row execute function public.set_updated_at();

alter table public.company_worlds enable row level security;

commit;
