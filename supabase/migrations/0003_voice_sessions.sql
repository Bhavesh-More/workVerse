-- 0003: Real-time voice sessions (ElevenAgents)
-- Adds a voice_sessions table linked to an authoritative simulation_sessions row, plus
-- provenance columns on conversation_messages so finalized voice turns can be deduplicated
-- by provider message id and reconciled. Additive and safe to re-run.
--
-- Identity note: internal profile ids are UUIDs (Clerk is mapped via profiles.clerk_user_id).

begin;

create table if not exists public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.simulation_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  npc_id text not null check (char_length(npc_id) between 1 and 80),
  agent_config_key text not null default '' check (char_length(agent_config_key) <= 160),
  provider_conversation_id text check (provider_conversation_id is null or char_length(provider_conversation_id) <= 200),
  status text not null default 'created'
    check (status in ('created', 'connecting', 'active', 'ended', 'failed', 'expired')),
  end_reason text check (end_reason is null or char_length(end_reason) <= 200),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  connected_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists voice_sessions_session_created_idx
  on public.voice_sessions (session_id, created_at desc);
create index if not exists voice_sessions_user_created_idx
  on public.voice_sessions (user_id, created_at desc);
create unique index if not exists voice_sessions_provider_conversation_idx
  on public.voice_sessions (provider_conversation_id)
  where provider_conversation_id is not null;
-- At most one live voice session per WorkVerse session.
create unique index if not exists voice_sessions_one_active_idx
  on public.voice_sessions (session_id)
  where status in ('created', 'connecting', 'active');

drop trigger if exists voice_sessions_set_updated_at on public.voice_sessions;
create trigger voice_sessions_set_updated_at
before update on public.voice_sessions
for each row execute function public.set_updated_at();

-- Provenance for transcript turns. Final voice text is stored verbatim; provider ids
-- allow deterministic deduplication when events are replayed.
alter table public.conversation_messages
  add column if not exists provider_message_id text;
alter table public.conversation_messages
  add column if not exists source text not null default 'text';
alter table public.conversation_messages
  drop constraint if exists conversation_messages_source_check;
alter table public.conversation_messages
  add constraint conversation_messages_source_check
  check (source in ('text', 'elevenlabs-sdk', 'server-reconcile'));

create unique index if not exists conversation_messages_provider_message_idx
  on public.conversation_messages (session_id, provider_message_id)
  where provider_message_id is not null;

alter table public.voice_sessions enable row level security;

drop policy if exists voice_sessions_select_own on public.voice_sessions;
create policy voice_sessions_select_own on public.voice_sessions for select to authenticated
using ((select auth.uid()) = user_id);

commit;
