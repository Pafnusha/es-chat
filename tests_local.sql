-- Локальная проверка схемы чата на обычном PostgreSQL (без Supabase).
-- Поднимает роли/стабы, загружает 01+02, потом проверяет поведение под ролью anon.
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;

drop schema if exists storage cascade;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, created_at timestamptz default now());
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null, name text not null, created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
insert into storage.buckets (id, name, public) values ('chatmedia','chatmedia', true);

\ir 01-schema.sql
\ir 02-rpc.sql

-- ─────────────────────────── проверки под anon ───────────────────────────
set role anon;

select '1. первый ник закрепляется за кодом' as t,
       public.chat_auth('Иван',''||repeat('a',64)) as ok1;
select '2. повтор с тем же кодом — ок' as t, public.chat_auth('Иван', repeat('a',64)) as ok2;
select '3. чужой код к заня нику — отказ' as t, public.chat_auth('Иван', repeat('b',64)) as bad;
select '4. коротки ник — отказ' as t, public.chat_auth('П', repeat('a',64)) as bad2;
select '5. прямой доступ к таблице identity запрещён' as t,
       (select count(*) from information_schema.role_table_grants
         where grantee='anon' and table_name='chat_identity') as grants_to_anon;

-- комнаты и открытые сообщения
select '6. канал создан' as t, public.chat_room_add('channel','Общий','Иван') as room;
select '7. дубль канала не создаёт вторую комнату' as t,
       public.chat_room_add('channel','Общий','Петр') is not null as ok;
select '8. отправка в канал' as t, public.chat_send(
        (select id from public.chat_room where name='Общий'), 'Иван','Привет, это ЭС-чат', null);
select '9. чтение открытых сообщенийPossible' as t, count(*) as msgs from public.chat_message;

-- ЛС
select '10. создавать ЛС можно только с известным ником' as t,
       public.chat_is_me('Иван', repeat('a',64)) as me_ok,
       public.chat_is_me('Иван', repeat('c',64)) as me_bad;
select '11. отправка ЛС с правильным кодом' as t,
       public.chat_dm_send('Иван', repeat('a',64), 'Мария', 'По каналу А-10 — смотри кабель', null);
select '12. отправка ЛС с чужим кодом — ошибка' as t,
       public.chat_dm_send('Иван', repeat('c',64), 'Мария', 'утечка', null);
