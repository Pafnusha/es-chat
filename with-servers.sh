#!/bin/bash
# поднимает эмулятор + статику, прогоняет диагностику и оставляет серверы живыми до конца вызова
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/lib/postgresql/17/bin
export PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
cd /tmp/qwenwork/chat
pg_ctl -D /tmp/qwenwork/pg/data status >/dev/null 2>&1 || pg_ctl -D /tmp/qwenwork/pg/data -o "-k /tmp/qwenwork/pg -c listen_addresses=''" -l /tmp/qwenwork/pg/pg.log start
sleep 1
python3 tests/mock_supabase.py 8123 >/tmp/qwenwork/chat/tests/mock.log 2>&1 &
M=$!
python3 -m http.server 4173 --bind 127.0.0.1 >/tmp/qwenwork/chat/tests/http.log 2>&1 &
S=$!
sleep 2
"$@" 2>&1
RC=$?
kill $M $S 2>/dev/null
exit $RC
