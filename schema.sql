create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx
  on public.conversations(user_id, updated_at desc);

create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at);

create index if not exists messages_user_id_idx
  on public.messages(user_id);

-- Automatically keep conversations.updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists conversations_set_updated_at on public.conversations;

create trigger conversations_set_updated_at
before update on public.conversations
for each row
execute function public.set_updated_at();

create or replace function public.touch_conversation_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;

create trigger messages_touch_conversation
after insert on public.messages
for each row
execute function public.touch_conversation_updated_at();

-- Enable Row Level Security
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

grant usage on schema public to authenticated;

grant select, insert, update, delete
  on public.conversations to authenticated;

grant select, insert, update, delete
  on public.messages to authenticated;

-- Conversations RLS Policies
drop policy if exists "Users read own conversations"
  on public.conversations;

create policy "Users read own conversations"
on public.conversations
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create own conversations"
  on public.conversations;

create policy "Users create own conversations"
on public.conversations
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own conversations"
  on public.conversations;

create policy "Users update own conversations"
on public.conversations
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own conversations"
  on public.conversations;

create policy "Users delete own conversations"
on public.conversations
for delete to authenticated
using ((select auth.uid()) = user_id);

-- Messages RLS Policies
drop policy if exists "Users read own messages"
  on public.messages;

create policy "Users read own messages"
on public.messages
for select to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and c.user_id = (select auth.uid())
  )
);

drop policy if exists "Users create own messages"
  on public.messages;

create policy "Users create own messages"
on public.messages
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and c.user_id = (select auth.uid())
  )
);

drop policy if exists "Users update own messages"
  on public.messages;

create policy "Users update own messages"
on public.messages
for update to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and c.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and c.user_id = (select auth.uid())
  )
);

drop policy if exists "Users delete own messages"
  on public.messages;

create policy "Users delete own messages"
on public.messages
for delete to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.conversations c
    where c.id = conversation_id
      and c.user_id = (select auth.uid())
  )
);
