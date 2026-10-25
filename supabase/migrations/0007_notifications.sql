-- 0007: In-app notifications
-- Companies can deliver assessment invites inside WorkVerse instead of (or as well as) email, and
-- company owners hear when candidates start and finish. A notification goes to a profile; when the
-- recipient has no account yet it waits under their email and is claimed the first time someone
-- signs in with that (verified) address. popped_at = the live popup was shown; read_at = opened.
-- Additive, re-runnable.

begin;

alter table public.profiles add column if not exists email text;
create index if not exists profiles_email_idx on public.profiles (lower(email));

alter table public.assessment_invites add column if not exists channel text not null default 'email';
alter table public.assessment_invites drop constraint if exists assessment_invites_channel_check;
alter table public.assessment_invites add constraint assessment_invites_channel_check check (channel in ('email', 'app', 'both'));
alter table public.assessment_invites add column if not exists notified_at timestamptz;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid references public.profiles(id) on delete cascade,
  recipient_email text check (recipient_email is null or char_length(recipient_email) between 3 and 320),
  kind text not null check (kind in ('assessment_invite', 'candidate_started', 'candidate_completed')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 1000),
  link text check (link is null or char_length(link) <= 500),
  data jsonb not null default '{}'::jsonb,
  popped_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (recipient_profile_id is not null or recipient_email is not null)
);
create index if not exists notifications_recipient_idx on public.notifications (recipient_profile_id, created_at desc);
create index if not exists notifications_unclaimed_idx on public.notifications (lower(recipient_email)) where recipient_profile_id is null;

alter table public.notifications enable row level security;

commit;
