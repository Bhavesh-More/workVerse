-- 0009: Company assessments as their own candidate journey
--
-- Company profile (shown to invited candidates): a short tagline plus optional about, mission,
-- vision, values, industry and website. All optional; candidates see only what is filled in.
--
-- Assessment briefing: description, what candidates should demonstrate, instructions, the skills
-- emphasised, and an optional due date (one deadline shared by every candidate, stored in UTC,
-- with the timezone the company chose so it can be shown both ways). client_request_id makes
-- publishing idempotent (a retried or double-clicked publish returns the same assessment).
--
-- Invitation lifecycle (assessment_invites.status): pending -> accepted | declined, and
-- revoked by the company from pending/accepted. Accepting never starts the test: the attempt
-- (simulation session) is created only by an explicit start, and its own status gives
-- in progress / submitted / evaluated. Overdue and expired are derived from due_at, so a
-- changed deadline is reflected without rewriting history. Timestamps keep the history.
--
-- Notifications: more kinds, and a dedupe key so retried events and lazy reminders are created
-- once. Additive and re-runnable.

begin;

alter table public.companies add column if not exists tagline text check (tagline is null or char_length(tagline) <= 160);
alter table public.companies add column if not exists about text check (about is null or char_length(about) <= 1200);
alter table public.companies add column if not exists mission text check (mission is null or char_length(mission) <= 600);
alter table public.companies add column if not exists vision text check (vision is null or char_length(vision) <= 600);
alter table public.companies add column if not exists company_values text check (company_values is null or char_length(company_values) <= 600);
alter table public.companies add column if not exists industry text check (industry is null or char_length(industry) <= 80);
alter table public.companies add column if not exists website text check (website is null or char_length(website) <= 200);

alter table public.assessments add column if not exists description text not null default '' check (char_length(description) <= 2000);
alter table public.assessments add column if not exists expectations text not null default '' check (char_length(expectations) <= 2000);
alter table public.assessments add column if not exists instructions text not null default '' check (char_length(instructions) <= 3000);
alter table public.assessments add column if not exists skills jsonb not null default '[]'::jsonb;
alter table public.assessments add column if not exists due_at timestamptz;
alter table public.assessments add column if not exists timezone text check (timezone is null or char_length(timezone) <= 64);
alter table public.assessments add column if not exists closed_at timestamptz;
alter table public.assessments add column if not exists client_request_id text check (client_request_id is null or char_length(client_request_id) between 8 and 80);
create unique index if not exists assessments_client_request_idx on public.assessments (company_id, client_request_id) where client_request_id is not null;

alter table public.assessment_invites add column if not exists status text not null default 'pending';
alter table public.assessment_invites drop constraint if exists assessment_invites_status_check;
alter table public.assessment_invites add constraint assessment_invites_status_check check (status in ('pending', 'accepted', 'declined', 'revoked'));
alter table public.assessment_invites add column if not exists accepted_at timestamptz;
alter table public.assessment_invites add column if not exists declined_at timestamptz;
alter table public.assessment_invites add column if not exists decline_reason text check (decline_reason is null or char_length(decline_reason) <= 500);
alter table public.assessment_invites add column if not exists revoked_at timestamptz;
-- Invites that already have a run were accepted (the old flow started immediately).
update public.assessment_invites set status = 'accepted', accepted_at = coalesce(accepted_at, started_at, now())
  where session_id is not null and status = 'pending';
create index if not exists assessment_invites_profile_idx on public.assessment_invites (profile_id) where profile_id is not null;
create index if not exists assessment_invites_email_idx on public.assessment_invites (lower(email));

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'assessment_invite', 'candidate_started', 'candidate_completed',
  'invite_accepted', 'invite_declined', 'due_changed', 'assessment_withdrawn', 'due_soon'));
alter table public.notifications add column if not exists dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 200);
create unique index if not exists notifications_dedupe_idx on public.notifications (dedupe_key) where dedupe_key is not null;

commit;
