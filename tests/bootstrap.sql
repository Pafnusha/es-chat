-- Эмуляция окружения Supabase для локального прогона: роли, storage-стаб, схемы.
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;

drop schema if exists storage cascade;
create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean default true, created_at timestamptz default now());
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  created_at timestamptz not null default now());
alter table storage.objects enable row level security;
insert into storage.buckets (id, name) values ('chatmedia','chatmedia') on conflict do nothing;

\ir /tmp/qwenwork/chat/sql/01-schema.sql
\ir /tmp/qwenwork/chat/sql/02-rpc.sql
