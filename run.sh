#!/bin/bash
# полный локальный прогон: чистая БД → эмулятор Supabase → статика → сквозной тест
set -u
export PATH=/usr/lib/postgresql/17/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
cd /tmp/qwenwork/chat
pg_ctl -D /tmp/qwenwork/pg/data status >/dev/null 2>&1 || pg_ctl -D /tmp/qwenwork/pg/data -o "-k /tmp/qwenwork/pg -c listen_addresses=''" -l /tmp/qwenwork/pg/pg.log start
sleep 1
psql -h /tmp/qwenwork/pg -U postgres -q -c "drop database if exists eschat" -c "create database eschat"
psql -h /tmp/qwenwork/pg -U postgres -d eschat -q -v ON_ERROR_STOP=1 -f tests/bootstrap.sql || exit 1
rm -rf store; mkdir -p store
python3 tests/mock_supabase.py 8123 >/tmp/qwenwork/chat/tests/mock.log 2>&1 &
MOCK=$!
python3 -m http.server 4173 --bind 127.0.0.1 >/tmp/qwenwork/chat/tests/http.log 2>&1 &
HTTPD=$!
trap 'kill $MOCK $HTTPD 2>/dev/null' EXIT
sleep 2
python3 tests/e2e.py; RC=$?
psql -h /tmp/qwenwork/pg -U postgres -d eschat -c "
 select 'rooms' k, count(*) from public.chat_room union all
 select 'messages', count(*) from public.chat_message union all
 select 'dm', count(*) from public.chat_dm union all
 select 'files', count(*) from storage.objects"
echo "store:"; find store -type f | head
exit $RC
