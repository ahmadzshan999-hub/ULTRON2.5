-- Run this entire file in Supabase SQL Editor.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx
  on public.conversations(user_id, updated_at desc);
create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Users manage their own conversations" on public.conversations;
create policy "Users manage their own conversations"
on public.conversations for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage their own messages" on public.messages;
create policy "Users manage their own messages"
on public.messages for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- The API server uses the caller's Supabase access token and anon key,
-- so Row Level Security remains active for database requests.
