-- Звонки ЭС-чат: голосовые и видео. Выполнить в SQL Editor после 01 и 02.
-- Сигналинг WebRTC лежит в таблице; медиа идёт напрямую между браузерами.

create table if not exists public.chat_call (
  id         uuid primary key default gen_random_uuid(),
  caller     text not null,
  callee     text not null,
  kind       text not null check (kind in ('audio','video')),
  state      text not null default 'ringing' check (state in ('ringing','accepted','ended')),
  offer      text,
  answer     text,
  ice        jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  ended_at   timestamptz,
  check (caller <> callee)
);
create index if not exists chat_call_party_idx on public.chat_call (callee, state, created_at desc);
create index if not exists chat_call_ttl_idx on public.chat_call (created_at);

revoke all on public.chat_call from anon, authenticated;
alter table public.chat_call enable row level security;

create or replace function public.chat_call_start(
  p_nick text, p_code_hash text, p_peer text, p_kind text, p_offer text
) returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  if p_peer is null or trim(p_peer) = '' or p_peer = p_nick then raise exception 'peer'; end if;
  if p_kind not in ('audio','video') then raise exception 'kind'; end if;
  if p_offer is null or char_length(p_offer) < 20 then raise exception 'offer'; end if;
  if not exists (select 1 from public.chat_identity i where i.nick = p_peer) then
    raise exception 'unknown peer';
  end if;
  update public.chat_call
     set state = 'ended', ended_at = now()
   where state <> 'ended'
     and ((caller = p_nick and callee = p_peer) or (caller = p_peer and callee = p_nick));
  insert into public.chat_call (caller, callee, kind, offer)
    values (p_nick, p_peer, p_kind, p_offer)
    returning id into cid;
  perform public.chat_touch(p_nick);
  return cid;
end $$;

create or replace function public.chat_call_inbox(p_nick text, p_code_hash text)
returns table (
  id uuid, caller text, callee text, kind text, state text,
  offer text, answer text, ice jsonb, created_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  return query
    select c.id, c.caller, c.callee, c.kind, c.state, c.offer, c.answer, c.ice, c.created_at
    from public.chat_call c
    where p_nick in (c.caller, c.callee)
      and c.state in ('ringing','accepted')
      and c.created_at > now() - interval '15 minutes'
    order by c.created_at desc
    limit 8;
end $$;

create or replace function public.chat_call_get(p_nick text, p_code_hash text, p_id uuid)
returns table (
  id uuid, caller text, callee text, kind text, state text,
  offer text, answer text, ice jsonb, created_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  return query
    select c.id, c.caller, c.callee, c.kind, c.state, c.offer, c.answer, c.ice, c.created_at
    from public.chat_call c
    where c.id = p_id and p_nick in (c.caller, c.callee);
end $$;

create or replace function public.chat_call_answer(
  p_nick text, p_code_hash text, p_id uuid, p_answer text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  if p_answer is null or char_length(p_answer) < 20 then raise exception 'answer'; end if;
  update public.chat_call
     set answer = p_answer, state = 'accepted'
   where id = p_id and callee = p_nick and state = 'ringing';
  if not found then raise exception 'no call'; end if;
  perform public.chat_touch(p_nick);
end $$;

create or replace function public.chat_call_ice(
  p_nick text, p_code_hash text, p_id uuid, p_cand text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  if p_cand is null or char_length(p_cand) < 8 then return; end if;
  update public.chat_call
     set ice = ice || jsonb_build_array(jsonb_build_object('from', p_nick, 'cand', p_cand))
   where id = p_id
     and p_nick in (caller, callee)
     and state in ('ringing','accepted')
     and jsonb_array_length(ice) < 80;
end $$;

create or replace function public.chat_call_hangup(
  p_nick text, p_code_hash text, p_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_me(p_nick, p_code_hash) then raise exception 'wrong code'; end if;
  update public.chat_call
     set state = 'ended', ended_at = now()
   where id = p_id and p_nick in (caller, callee) and state <> 'ended';
end $$;

grant execute on function
  public.chat_call_start(text,text,text,text,text),
  public.chat_call_inbox(text,text),
  public.chat_call_get(text,text,uuid),
  public.chat_call_answer(text,text,uuid,text),
  public.chat_call_ice(text,text,uuid,text),
  public.chat_call_hangup(text,text,uuid)
  to anon, authenticated;
