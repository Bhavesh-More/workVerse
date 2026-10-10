-- 0002: Clerk identity
-- Identity moves from Supabase Auth to Clerk. Internal profile ids remain UUIDs so that
-- every existing foreign key is preserved; Clerk users are mapped through a unique
-- clerk_user_id column. Profiles are created by the backend on first authenticated request.

begin;

-- Profiles are no longer tied to Supabase auth.users.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column if not exists clerk_user_id text;
create unique index if not exists profiles_clerk_user_id_key on public.profiles (clerk_user_id);

-- Remove the Supabase-auth signup trigger and function.
drop trigger if exists on_auth_user_created_workverse on auth.users;
drop function if exists public.handle_new_auth_user();

commit;
