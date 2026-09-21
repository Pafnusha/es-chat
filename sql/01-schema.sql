-- ЭС-чат: схема для Supabase (PostgreSQL 15+/17).
-- Модель: без регистрации. Ник + код-пароль = ключ к личным сообщениям.
-- Каналы и группы открыты для всех; ЛС читаются только той парой ников,
-- причём каждый из пары входит по своему коду. Всё стерто через 48 часов.

create extension if not exists pgcrypto;

-- ── идентифичность: первый, кто придумал ник, закрепляет его за своим кодом ──
create table if not exists public.chat_identity (
  nick        text primary key check (char_length(nick) between 2 and 24),
  secret_hash text not null,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ── комнаты: каналы (публичные) и группы (публичные, с создателем) ──
create table if not exists public.chat_room (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('channel','group')),
  name       text not null check (char_length(name) between 1 and 60),
  topic      text,
  owner      text,
  created_at timestamptz not null default now(),
  unique (kind, name)
);

create table if not exists public.chat_member (
  room_id   uuid not null references public.chat_room(id) on delete cascade,
  nick      text not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, nick)
);

-- открытая переписка (каналы/группы) — читается всеми, в т.ч. через Realtime
create table if not exists public.chat_message (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.chat_room(id) on delete cascade,
  author     text not null,
  body       text not null default '',
  media      text,                       -- data-URL сжатого фото (≤ ~300 КБ)
  created_at timestamptz not null default now(),
  check (char_length(body) <= 4000),
  check (char_length(coalesce(media,'')) <= 400000)
);
create index if not exists chat_message_room_idx on public.chat_message (room_id, id desc);
create index if not exists chat_message_ttl_idx on public.chat_message (created_at);

-- личные сообщения: доступ только через RPC (прав anon на таблицу нет).
-- media хранит data-URL прямо в строке. Внешнее хранилище не используется:
-- чтобы аноним мог удалить просроченный файл, ему нужна полития SELECT на
-- storage.objects, а это заодно открывает перебор путей чужих вложений.
create table if not exists public.chat_dm (
  id         bigint generated always as identity primary key,
  pair_key   text not null,               -- 'никА|никБ' в алфавитном порядке
  nick_a     text not null,
  nick_b     text not null,
  author     text not null,
  body       text not null default '',
  media      text,                        -- base64 data-URL сжатого фото (не path)
  created_at timestamptz not null default now(),
  check (char_length(coalesce(media,'')) <= 400000),
  check (author in (nick_a, nick_b)),
  check (nick_a < nick_b)
);
create index if not exists chat_dm_pair_idx on public.chat_dm (pair_key, id desc);
create index if not exists chat_dm_ttl_idx on public.chat_dm (created_at);

-- служебное: чтобы «метёлка» не запускалась со всех клиентов одновременно
create table if not exists public.chat_janitor (
  id smallint primary key default 1 check (id = 1),
  ran_at timestamptz not null default '1970-01-01'
);
insert into public.chat_janitor (id) values (1) on conflict do nothing;
