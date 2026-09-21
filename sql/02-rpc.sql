-- ЭС-чат: RPC и права. Вызывать после 01-schema.sql и после создания bucket 'chatmedia'.

-- ─── вход по нику: кто первый придумал ник, тот и хозяин кода ───
create or replace function public.chat_auth(p_nick text, p_code_hash text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare r public.chat_identity;
begin
  p_nick := trim(coalesce(p_nick,''));
  if char_length(p_nick) < 2 or char_length(p_nick) > 24 then
    return jsonb_build_object('ok', false, 'error', 'nick_length');
  end if;
  if p_code_hash is null or length(p_code_hash) <> 64 then
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;
  select * into r from public.chat_identity where nick = p_nick;
  if not found then
    insert into public.chat_identity (nick, secret_hash) values (p_nick, p_code_hash);
    return jsonb_build_object('ok', true, 'first', true);
  end if;
  if r.secret_hash <> p_code_hash then
    return jsonb_build_object('ok', false, 'error', 'nick_taken');
  end if;
  update public.chat_identity set last_seen_at = now() where nick = p_nick;
  return jsonb_build_object('ok', true, 'first', false);
end $$;

-- ─── комнаты ───
create or replace function public.chat_room_add(p_kind text, p_name text, p_nick text, p_code_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare id uuid;
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  if p_kind not in ('channel','group') then raise exception 'kind'; end if;
  if char_length(trim(p_name)) < 1 then raise exception 'name'; end if;
  insert into public.chat_room (kind, name, owner)
    values (p_kind, trim(p_name), p_nick)
    on conflict (kind, name) do update set name = excluded.name
    returning chat_room.id into id;
  return id;
end $$;

create or replace function public.chat_join(p_room uuid, p_nick text, p_code_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  insert into public.chat_member (room_id, nick) values (p_room, p_nick) on conflict do nothing;
end $$;

create or replace function public.chat_leave(p_room uuid, p_nick text, p_code_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  delete from public.chat_member where room_id = p_room and nick = p_nick;
end $$;

create or replace function public.chat_send(p_room uuid, p_nick text, p_code_hash text,
                              p_body text, p_media text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  if not exists (select 1 from public.chat_room r where r.id = p_room) then
    raise exception 'no room';
  end if;
  if char_length(coalesce(p_body,'')) > 4000 then raise exception 'too long'; end if;
  if coalesce(p_body,'') = '' and p_media is null then return; end if;
  if char_length(coalesce(p_media,'')) > 400000 then raise exception 'img too big'; end if;
  if p_media is not null and p_media !~ '^data:image/(jpeg|png|webp);base64,' then raise exception 'bad img'; end if;
  perform public.chat_touch(p_nick);
  insert into public.chat_message (room_id, author, body, media)
    values (p_room, p_nick, left(coalesce(p_body,''),4000), p_media);
end $$;

create or replace function public.chat_touch(p_nick text)
returns void language sql security definer set search_path = public as $$
  update public.chat_identity set last_seen_at = now() where nick = p_nick;
$$;

-- ─── личные сообщения: право чтения = свой ник + свой код ───
create or replace function public.chat_pair(a text, b text)
returns text language sql immutable as $$
  select case when a < b then a || '|' || b else b || '|' || a end;
$$;

create or replace function public.chat_dm_send(p_nick text, p_code_hash text,
                                               p_peer text, p_body text, p_media text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  if p_peer is null or trim(p_peer) = '' or p_peer = p_nick then
    raise exception 'peer';
  end if;
  if not exists (select 1 from public.chat_identity i where i.nick = p_peer) then
    raise exception 'unknown peer';   -- адресат должен уже владеть ником, иначе ему нечем открыть ЛС
  end if;
  if char_length(coalesce(p_body,'')) > 4000 then raise exception 'too long'; end if;
  if char_length(coalesce(p_media,'')) > 400000 then raise exception 'img too big'; end if;
  if p_media is not null and p_media !~ '^data:image/(jpeg|png|webp);base64,' then raise exception 'bad img'; end if;
  if coalesce(p_body,'') = '' and p_media is null then return; end if;
  insert into public.chat_dm (pair_key, nick_a, nick_b, author, body, media)
    values (public.chat_pair(p_nick, p_peer),
            least(p_nick, p_peer), greatest(p_nick, p_peer),
            p_nick, left(coalesce(p_body,''),4000), p_media);
end $$;

create or replace function public.chat_dm_history(p_nick text, p_code_hash text,
                                                  p_peer text, p_before bigint default null,
                                                  p_limit int default 60)
returns table (id bigint, author text, body text, media text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare pk text;
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  pk := public.chat_pair(p_nick, p_peer);
  return query
    select m.id, m.author, m.body, m.media, m.created_at from public.chat_dm m
    where m.pair_key = pk
      and (p_before is null or m.id < p_before)
    order by m.id desc limit least(p_limit, 200);
end $$;

create or replace function public.chat_dm_peers(p_nick text, p_code_hash text)
returns table (peer text, last_id bigint, last_at timestamptz, recent_48h int)
language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  return query
    select (case when d.nick_a = p_nick then d.nick_b else d.nick_a end) as peer,
           max(d.id), max(d.created_at), count(*) filter (
             where d.created_at > now() - interval '48 hour')::int
    from public.chat_dm d
    where p_nick in (d.nick_a, d.nick_b)
    group by 1 order by max(d.created_at) desc;
end $$;

-- проверка «это я»: ник зарегистрирован и код совпал (в базе лежит sha256)
create or replace function public.chat_is_me(p_nick text, p_code_hash text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.chat_identity
                 where nick = p_nick and secret_hash = p_code_hash);
$$;

-- активные ники (заходили за последние 5 минут)
create or replace function public.chat_online()
returns table (nick text, seen timestamptz)
language sql security definer set search_path = public as $$
  select i.nick, i.last_seen_at from public.chat_identity i
  where i.last_seen_at > now() - interval '5 minutes'
  order by i.last_seen_at desc limit 200;
$$;

-- ─── автоочистка: всё, что старше 48 часов ───
create or replace function public.chat_gc()
returns jsonb language plpgsql security definer set search_path = public as $$
declare m int; d int; lim timestamptz := now() - interval '48 hour'; busy timestamptz;
begin
  select ran_at into busy from public.chat_janitor where id = 1 for update;
  if busy > now() - interval '2 minutes' then
    return jsonb_build_object('skipped', true);
  end if;
  delete from public.chat_message where created_at < lim;
  get diagnostics m = row_count;
  delete from public.chat_dm where created_at < lim;
  get diagnostics d = row_count;
  delete from public.chat_room r
    where r.created_at < lim
      and not exists (select 1 from public.chat_message m2 where m2.room_id = r.id);
  update public.chat_janitor set ran_at = now() where id = 1;
  return jsonb_build_object('messages', m, 'dm', d, 'before', lim);
end $$;

-- ─── права: анониму — только RPC + чтение открытых комнат ───
grant usage on schema public to anon, authenticated;
grant select on public.chat_room, public.chat_message, public.chat_member to anon, authenticated;
revoke all on public.chat_identity, public.chat_dm, public.chat_janitor from anon, authenticated;
grant execute on function
  public.chat_auth(text,text), public.chat_is_me(text,text), public.chat_touch(text),
  public.chat_online(), public.chat_room_add(text,text,text,text),
  public.chat_join(uuid,text,text), public.chat_leave(uuid,text,text),
  public.chat_send(uuid,text,text,text,text), public.chat_dm_send(text,text,text,text,text),
  public.chat_dm_history(text,text,text,bigint,int), public.chat_dm_peers(text,text),
  public.chat_pair(text,text), public.chat_gc()
  to anon, authenticated;

-- Delivery — опрос клиентом (дешевле и надёжнее через корпоративные прокси),
-- потому publication supabase_realtime тут не подключаем.

alter table public.chat_message enable row level security;
alter table public.chat_room   enable row level security;
alter table public.chat_member enable row level security;

drop policy if exists "open read" on public.chat_message;
create policy "open read" on public.chat_message for select to anon, authenticated using (true);
drop policy if exists "rooms read" on public.chat_room;
create policy "rooms read" on public.chat_room for select to anon, authenticated using (true);
drop policy if exists "members read" on public.chat_member;
create policy "members read" on public.chat_member for select to anon, authenticated using (true);

