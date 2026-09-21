-- Прогон поведения Чат-ядра под ролью anon (как это делает браузер с публичным anon key)
set client_min_messages = notice;
\i /tmp/qwenwork/chat/tests/bootstrap.sql

set role anon;

\echo '=== 1. вход: первый заявляет ник ==='
select public.chat_auth('Иван', repeat('a',64)) as first_login;
select public.chat_auth('Мария', repeat('b',64)) as second_login;

\echo '=== 2. тот же ник + свой код — пускает ==='
select public.chat_auth('Иван', repeat('a',64)) as again_ok;

\echo '=== 3. чужой код к занятому нику — отказ (ник уже «придуман» кем-то другим) ==='
select public.chat_auth('Иван', repeat('c',64)) as taken;

\echo '=== 4. прямой доступ к таблице лички и identity закрыт ==='
do $$ begin
  perform * from public.chat_dm;
  raise exception 'ОШИБКА: anon прочитал chat_dm';
exception when insufficient_privilege then raise notice 'ок: chat_dm недоступна anon';
end $$;
do $$ begin
  perform * from public.chat_identity;
  raise exception 'ОШИБКА: anon прочитал chat_identity';
exception when insufficient_privilege then raise notice 'ок: chat_identity недоступна anon';
end $$;

\echo '=== 5. открытая комната: создание, дубликат, пост ==='
create temp table t_room(r uuid);
insert into t_room select public.chat_room_add('channel','ЭС-общий','Иван', repeat('a',64));
select public.chat_room_add('channel','ЭС-общий','Мария', repeat('b',64)) = (select r from t_room) as same_room;
select public.chat_send((select r from t_room),'Иван', repeat('a',64),'Передатчики 6кВ на кусте 14 — смотрим', null) as post1;
select public.chat_send((select r from t_room),'Мария', repeat('b',64),'Готово, добавил в ведомость', null) as post2;
select count(*) as open_msgs_visible from public.chat_message;

\echo '=== 6. поддельный ник в открытом канале невозможен без кода ==='
do $$ begin
  perform public.chat_send((select r from t_room),'Иван', repeat('z',64),'от чужого имени', null);
  raise exception 'ОШИБКА: публикация под чужим ником прошла';
exception when others then raise notice 'ок: %', sqlerrm; end $$;

\echo '=== 7. личка: отправка только с правильным кодом, адресат должен владеть ником ==='
select public.chat_dm_send('Иван', repeat('a',64), 'Мария', 'по ПУЭ 1.7.89 нужно пересчит', null) as dm_sent;
do $$ begin
  perform public.chat_dm_send('Иван', repeat('c',64), 'Мария', 'утечка', null);
  raise exception 'ОШИБКА: ЛС ушли с неверным кодом';
exception when raise_exception then raise notice 'ок: %', sqlerrm; end $$;
do $$ begin
  perform public.chat_dm_send('Иван', repeat('a',64), 'Призраки', 'в никуда', null);
  raise exception 'ОШИБКА: ЛС отправлены несуществующему нику';
exception when raise_exception then raise notice 'ок: %', sqlerrm; end $$;

\echo '=== 8. чтение лички: Ивановским кодом — видно, чужим — нет ==='
select count(*) as dm_for_ivan from public.chat_dm_history('Иван', repeat('a',64), 'Мария');
select count(*) as dm_for_maria from public.chat_dm_history('Мария', repeat('b',64), 'Иван');
do $$ begin
  perform * from public.chat_dm_history('Иван', repeat('c',64), 'Мария');
  raise exception 'ОШИБКА: личка прочитана чужим кодом';
exception when raise_exception then raise notice 'ок: %', sqlerrm; end $$;

\echo '=== 9. третья сторона не видит переписку даже зная пару ников ==='
select public.chat_auth('Гость', repeat('d',64)) as guest;
select count(*) as guest_sees from public.chat_dm_history('Гость', repeat('d',64), 'Иван');
select count(*) as guest_peer_list from public.chat_dm_peers('Гость', repeat('d',64));

\echo '=== 10. списки: собеседники и «кто в чате» ==='
select peer, recent_48h from public.chat_dm_peers('Иван', repeat('a',64));
select count(*) > 0 as online_list_works from public.chat_online();

\echo '=== 11. вложения: только data-URL и не больше 400k ==='
do $$ begin
  perform public.chat_send((select r from t_room),'Иван', repeat('a',64),'скрин подстанции',
                            'data:image/jpeg;base64,'||repeat('A',3000));
  raise notice 'ок: вложение до 400k прошло';
exception when others then raise notice 'ОШИБКА: %', sqlerrm; end $$;
do $$ begin
  perform public.chat_send((select r from t_room),'Иван', repeat('a',64),'мусор', 'http://пример/фото.jpg');
  raise exception 'ОШИБКА: не-media строка прошла как вложение';
exception when others then raise notice 'ок: %', sqlerrm; end $$;
do $$ begin
  perform public.chat_send((select r from t_room),'Иван', repeat('a',64),'гигант',
                           'data:image/jpeg;base64,'||repeat('A',400001));
  raise exception 'ОШИБКА: вложение больше 400k прошло';
exception when others then raise notice 'ок: %', sqlerrm; end $$;
select count(*) as с_фото from public.chat_message where media is not null;

\echo '=== 12. автоочистка 48 часов ==='
reset role;
insert into public.chat_message (room_id, author, body, created_at)
  select (select r from t_room),'Иван','старое сообщение', now() - interval '49 hours';
insert into public.chat_dm (pair_key, nick_a, nick_b, author, body, created_at)
  values ('Иван|Мария','Иван','Мария','Иван','старое ЛС', now() - interval '49 hours');

select (public.chat_gc() ->> 'messages')::int as purged_msgs,
       coalesce((public.chat_gc() ->> 'dm')::int, -1) as dm_on_second_call_skipped;
set role anon;

select count(*) as left_open from public.chat_message;
select count(*) as left_dm from public.chat_dm_history('Иван', repeat('a',64), 'Мария');

\echo '=== 13. повторный GC в течение 2 минут пропускается (не дерём базу с каждой вкладки) ==='
select public.chat_gc() as gc_again;
reset role;
