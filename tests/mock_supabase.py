#!/usr/bin/env python3
"""Мини-эмулятор Supabase (PostgREST rpc/rest + Storage) поверх локального PostgreSQL.
Нужен только для сквозного теста клиента: семантику нужных клиенту запросов повторяет 1-в-1."""
import json, os, re, subprocess, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

DB = os.environ.get("ESCHAT_DB", "eschat")
STORAGE = os.environ.get("ESCHAT_STORE", "/tmp/qwenwork/chat/store")
PORT = int(sys.argv[1] if len(sys.argv) > 1 else 8123)
os.makedirs(STORAGE, exist_ok=True)


def sql(q):
    """выполняет запрос под ролью anon (как это делает браузер с anon-ключом) и возвращает строки"""
    r = subprocess.run(["psql", "-h", "/tmp/qwenwork/pg", "-U", "postgres", "-d", DB, "-tA", "-q",
                        "-v", "ON_ERROR_STOP=1", "-c", "set role anon;\n" + q],
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout).strip()[:200])
    return [ln for ln in r.stdout.splitlines() if ln != ""]


def j(q):
    return [json.loads(x) for x in sql(q)]


def s(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    return "'" + str(v).replace("'", "''") + "'"


def arg(name):
    return s(ARGS.get(name))


uuid_re = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, payload, ctype="application/json"):
        raw = payload if isinstance(payload, bytes) else json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-upsert, prefer, accept, accept-language, range")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith("/storage/v1/object/public/"):
            rel = unquote(u.path.split("/chatmedia/", 1)[-1])
            f = os.path.normpath(os.path.join(STORAGE, rel))
            if f.startswith(STORAGE) and os.path.isfile(f):
                return self._send(200, open(f, "rb").read(),
                                  {".png": "image/png", ".webp": "image/webp"}.get(os.path.splitext(f)[1], "image/jpeg"))
            return self._send(404, {"error": "not found"})

        qs = parse_qs(u.query)
        try:
            if u.path == "/rest/v1/chat_room":
                return self._send(200, j("select row_to_json(t) from (select id,kind,name,owner,topic,created_at"
                                         " from public.chat_room order by kind,name) t"))
            if u.path == "/rest/v1/chat_message":
                room = qs.get("room_id", [""])[0].replace("eq.", "")
                after = qs.get("id", [""])[0].replace("gt.", "")
                lim = int(qs.get("limit", ["200"])[0])
                if not uuid_re.match(room):
                    return self._send(400, {"error": "bad room"})
                w = f"room_id = {s(room)}::uuid" + (f" and id > {int(after)}" if after.isdigit() else "")
                rows = j(f"select row_to_json(t) from (select id,author,body,media,created_at"
                         f" from public.chat_message where {w} order by id desc limit {min(lim, 500)}) t")
                return self._send(200, rows)
        except Exception as e:  # noqa: BLE001
            return self._send(400, {"message": str(e)})
        return self._send(404, {"error": "n/a"})

    def do_POST(self):
        global ARGS
        u = urlparse(self.path)
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))

        if u.path.startswith("/storage/v1/object/chatmedia/"):
            rel = unquote(u.path.split("/chatmedia/", 1)[-1])
            if not re.fullmatch(r"[\w.\-А-Яа-яё]{1,24}/[0-9a-f]{16,}\.(jpg|jpeg|png|webp)", rel):
                return self._send(400, {"error": "bad path"})      # как политика eschat upload
            dest = os.path.normpath(os.path.join(STORAGE, rel))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, "wb").write(raw)
            sql(f"insert into storage.objects (bucket_id,name) values ('chatmedia', {s(rel)})")
            return self._send(200, {"Key": rel})
        if u.path.startswith("/storage/v1/object/list/"):
            return self._send(200, [])

        if u.path.startswith("/rest/v1/rpc/"):
            fn = u.path.rsplit("/", 1)[-1]
            try:
                ARGS = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                ARGS = {}
            try:
                rid = ARGS.get("p_room")
                if fn == "chat_auth":
                    return self._send(200, j(f"select public.chat_auth({arg('p_nick')},{arg('p_code_hash')})"))
                if fn == "chat_room_add":
                    return self._send(200, sql(f"select public.chat_room_add({arg('p_kind')},{arg('p_name')},"
                                               f"{arg('p_nick')},{arg('p_code_hash')})"))
                if fn in ("chat_join", "chat_leave"):
                    if not rid:
                        return self._send(204, b"")
                    sql(f"select public.{fn}({s(rid)}::uuid,{arg('p_nick')},{arg('p_code_hash')})")
                    return self._send(204, b"")
                if fn == "chat_send":
                    if not rid:
                        return self._send(400, {"message": "no room"})
                    sql(f"select public.chat_send({s(rid)}::uuid,{arg('p_nick')},{arg('p_code_hash')},"
                        f"{arg('p_body')},{arg('p_media')})")
                    return self._send(204, b"")
                if fn == "chat_dm_send":
                    sql(f"select public.chat_dm_send({arg('p_nick')},{arg('p_code_hash')},{arg('p_peer')},"
                        f"{arg('p_body')},{arg('p_media')})")
                    return self._send(204, b"")
                if fn == "chat_dm_history":
                    return self._send(200, j(f"select row_to_json(t) from public.chat_dm_history("
                                             f"{arg('p_nick')},{arg('p_code_hash')},{arg('p_peer')},null,120) t"))
                if fn == "chat_dm_peers":
                    return self._send(200, j(f"select row_to_json(t) from public.chat_dm_peers("
                                             f"{arg('p_nick')},{arg('p_code_hash')}) t"))
                if fn == "chat_online":
                    return self._send(200, j("select row_to_json(t) from public.chat_online() t"))
                if fn == "chat_gc":
                    return self._send(200, j("select public.chat_gc()"))
                if fn == "chat_gc_media":
                    got = sql("select to_jsonb(public.chat_gc_media())")
                    return self._send(200, json.loads(got[0]) if got else [])
            except Exception as e:  # noqa: BLE001
                return self._send(400, {"message": str(e)})
            return self._send(404, {"error": "no rpc " + fn})
        return self._send(404, {"error": "n/a"})

    def do_DELETE(self):
        u = urlparse(self.path)
        if "/chatmedia/" not in u.path:
            return self._send(404, {"error": "n/a"})
        rel = unquote(u.path.split("/chatmedia/", 1)[-1])
        # как Supabase: само удаление под RLS; анониму политика разрешает только просроченное
        gone = sql(f"delete from storage.objects where bucket_id='chatmedia' and name={s(rel)}"
                   f" returning name")
        if not gone:
            return self._send(404, {"error": "nothing deleted"})
        try:
            os.remove(os.path.join(STORAGE, rel))
        except OSError:
            pass
        return self._send(200, {"deleted": rel})


ARGS = {}
print(f"mock supabase on http://127.0.0.1:{PORT} (db={DB}, storage={STORAGE})", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
