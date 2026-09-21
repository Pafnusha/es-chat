import base64
import json
import subprocess
import urllib.error
import urllib.request

API = "http://127.0.0.1:8123"
H = {"Content-Type": "application/json", "apikey": "k", "Authorization": "Bearer k"}
import hashlib
def ch(nick, code):
    return hashlib.sha256(f"{nick}␟{code}".encode()).hexdigest()

def call(path, body=None, method="POST"):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers=H, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return r.status, raw[:400]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]

print("auth      ", call("/rest/v1/rpc/chat_auth", {"p_nick": "Иван", "p_code_hash": ch("Иван", "1111")}))
print("room_add  ", call("/rest/v1/rpc/chat_room_add",
                         {"p_kind": "channel", "p_name": "Тест-канал", "p_nick": "Иван", "p_code_hash": ch("Иван", "1111")}))
print("rooms GET ", call("/rest/v1/chat_room?select=id,kind,name,owner,topic,created_at&order=kind.asc,name.asc", method="GET"))
rid = json.loads(call("/rest/v1/chat_room?select=id", method="GET")[1])[0]["id"]
print("send      ", call("/rest/v1/rpc/chat_send",
                         {"p_room": rid, "p_nick": "Иван", "p_code_hash": ch("Иван", "1111"), "p_body": "привет", "p_media": None}))
print("msgs GET  ", call(f"/rest/v1/chat_message?select=id,author,body,media,created_at&room_id=eq.{rid}&order=id.desc&limit=50", method="GET"))
print("online    ", call("/rest/v1/rpc/chat_online", {}))
print("peers     ", call("/rest/v1/rpc/chat_dm_peers", {"p_nick": "Иван", "p_code_hash": ch("Иван", "1111")}))
png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAaklEQVR4nO3QMQEAMBDAwSH"
                       "R3TbG4QeamoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                       "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwrQwBAR6wJ/KAAAAAAElFTkSuQmCC")
req = urllib.request.Request(API + "/storage/v1/object/chatmedia/%D0%98%D0%B2%D0%B0%D0%BD/0123456789abcdef.jpg",
                             data=png, headers={**H, "Content-Type": "image/jpeg", "x-upsert": "false"}, method="POST")
with urllib.request.urlopen(req, timeout=20) as r:
    print("upload    ", r.status, r.read().decode()[:120])
print("media     ", subprocess.run(["find", "/tmp/qwenwork/chat/store", "-type", "f"], capture_output=True, text=True).stdout.strip())
print("gc_media  ", call("/rest/v1/rpc/chat_gc_media", {}))
print("gc        ", call("/rest/v1/rpc/chat_gc", {}))
print("err wrong code", call("/rest/v1/rpc/chat_send",
                             {"p_room": rid, "p_nick": "Иван", "p_code_hash": "f" * 64, "p_body": "хак", "p_media": None}))
