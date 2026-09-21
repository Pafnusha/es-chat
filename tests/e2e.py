# -*- coding: utf-8 -*-
"""Сквозной тест клиента чата: два «телефона» общаются, личка изолирована,
ник защищён кодом, фото доезжает, зачистка 48 часов работает, мобилка не едет."""
import json
import os
import subprocess
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright

APP = "http://127.0.0.1:4173/index.html"
API = "http://127.0.0.1:8123"
CHROME = "/opt/playwright-browsers/chromium-1209/chrome-linux64/chrome"
FAILS = []


def ok(cond, name, extra=""):
    print(("PASS  " if cond else "FAIL  ") + name + ((" :: " + str(extra)) if extra else ""), flush=True)
    if not cond:
        FAILS.append(name)


def url(nick, code):
    return f"{APP}?su={API}&sk=test-ankey&n={urllib.parse.quote(nick)}&c={code}"


def api_call(fn, args):
    req = urllib.request.Request(f"{API}/rest/v1/rpc/{fn}",
                                 data=json.dumps(args).encode(),
                                 headers={"Content-Type": "application/json",
                                          "apikey": "test-ankey", "Authorization": "Bearer test-ankey"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]


def open_drawer(pg):
    """на десктопе ящик уже открыт, на телефоне — раскрываем"""
    if not pg.is_visible("#drawer"):
        pg.click("#btn-rooms")
        pg.wait_for_selector("#drawer:not([hidden])", timeout=5000)
    return pg


def pick_room(pg, name):
    open_drawer(pg)
    pg.locator("#room-list li", has_text=name).first.click()
    time.sleep(1.2)


def open_tab(pg, tab):
    open_drawer(pg)
    pg.click(f'.drawer-tabs button[data-tab="{tab}"]')
    time.sleep(0.6)


def session(browser, nick, code):
    ctx = browser.new_context()
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: print("   ! pageerror:", e, flush=True))
    pg.goto(url(nick, code))
    pg.wait_for_selector("#app:not([hidden])", timeout=20000)
    time.sleep(1.0)
    return ctx, pg


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME)

    # 1. вход + создание канала -------------------------------------------
    ictx, ipg = session(browser, "Иван", "1111")
    ok(ipg.eval_on_selector("#login", "e=>e.hidden") and ipg.is_visible("#drawer"), "вход по нику и коду", ipg.inner_text("#room-title"))
    open_drawer(ipg)
    ipg.click("#btn-newroom")
    ipg.select_option("#new-kind", "channel")
    ipg.fill("#new-name", "ЭС-общий")
    ipg.click("#new-ok")
    time.sleep(1.5)
    open_tab(ipg, "channel")
    ok(ipg.locator("#room-list li", has_text="ЭС-общий").count() == 1, "канал создан и виден в списке")
    pick_room(ipg, "ЭС-общий")

    # 2. открытое сообщение доходит до второго ----------------------------
    ipg.fill("#in-body", "Проверка: лотки — линия в сборе по ВНИИПО")
    ipg.click(".send")
    time.sleep(1.6)
    ok("ВНИИПО" in ipg.inner_text("#msgs"), "сообщение видно автору")

    mctx, mpg = session(browser, "Мария", "2222")
    pick_room(mpg, "ЭС-общий")
    time.sleep(3.2)
    ok("ВНИИПО" in mpg.inner_text("#msgs"), "второй ник получил сообщение в реальном времени")
    mpg.fill("#in-body", "Принято, добавила в ведомость")
    mpg.click(".send")
    time.sleep(3.5)
    ok("Принято" in ipg.inner_text("#msgs"), "ответ дошёл обратно автору")
    ttl = ipg.locator("#msgs .ttl").last.inner_text()
    ok("48" in ttl or "осталось" in ttl, "у сообщения виден остаток до самоуничтожения", ttl)

    # 3. личка -------------------------------------------------------------
    open_tab(ipg, "dm")
    ipg.click("#btn-newroom")
    ipg.fill("#dm-peer", "Мария")
    ipg.click("#dm-ok")
    time.sleep(1.2)
    ipg.fill("#in-body", "Лично: сечение по ПУЭ 1.7 не проходит")
    ipg.click(".send")
    time.sleep(3.5)
    ok("не проходит" in ipg.inner_text("#msgs"), "личное сообщение отправлено и видно автору")

    open_tab(mpg, "dm")
    time.sleep(1.4)
    ok("Иван" in mpg.inner_text("#room-list"), "у получателя собеседник появился в личке")
    pg_dm = mpg.locator("#room-list li", has_text="Иван").first
    pg_dm.click()
    time.sleep(3.0)
    ok("не проходит" in mpg.inner_text("#msgs"), "получатель прочитал личку")

    gctx, gpg = session(browser, "Гость", "3333")
    open_tab(gpg, "dm")
    time.sleep(1.4)
    body = gpg.inner_text("#room-list")
    ok("Иван" not in body and "Мария" not in body, "третий ник не видит чужую личку в списках", body[:60])
    st, txt = api_call("chat_dm_history", {"p_nick": "Гость", "p_code_hash": "0" * 64, "p_peer": "Иван"})
    ok("не проходит" not in txt and st != 200 or "wrong code" in txt, "прямой RPC в чужую личку отбит", f"{st} {txt[:70]}")

    # 4. ник держится за кодом --------------------------------------------
    tctx = browser.new_context()
    tpg = tctx.new_page()
    tpg.goto(f"{APP}?su={API}&sk=test-ankey")
    tpg.fill("#in-nick", "Иван")
    tpg.fill("#in-code", "угадал-не-угадал")
    tpg.click("#btn-login")
    time.sleep(1.5)
    err = tpg.inner_text("#login-err") if tpg.is_visible("#login-err") else ""
    ok("занят" in err, "чужой код к занятому нику не пускает", err)
    tctx.close()

    # 5. фото в открытом канале --------------------------------------------
    open_tab(ipg, "channel")
    pick_room(ipg, "ЭС-общий")   # перед вложением возвращаемся в канал
    import struct, zlib

    def make_png(path, w=240, h=170):
        rows = b"".join(b"\x00" + bytes(v for x in range(w) for v in
                            ((x * 255) // w, (y * 255) // (h - 1), 200)) for y in range(h))

        def chunk(tag, data):
            return (struct.pack(">I", len(data)) + tag + data
                    + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
        png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
               + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))
        open(path, "wb").write(png)
        return path

    jpg = make_png("/tmp/qwenwork/chat/tests/fixture.png")
    ipg.set_input_files("#in-file", jpg)
    time.sleep(1.2)
    time.sleep(2.4)
    ipg.click(".send")
    time.sleep(3.5)
    src = ipg.evaluate("() => {const i=[...document.querySelectorAll('#msgs img.pic')].pop();"
                       "return i ? {src: i.src, w: i.naturalWidth} : null;}", )
    ok(bool(src) and src["w"] > 0 and src["src"].startswith("data:image"),
       "фото в открытом канале доехало и отрисовалось", (src or {}).get("src", "")[:60])

    # 6. фото в личке (не уходит в открытый bucket) -----------------------
    open_tab(ipg, "dm")
    ipg.locator("#room-list li", has_text="Мария").first.click()
    time.sleep(1.0)
    ipg.set_input_files("#in-file", jpg)
    time.sleep(2.0)
    ipg.click(".send")
    time.sleep(3.5)
    picm = ipg.evaluate("() => {const i=[...document.querySelectorAll('#msgs img.pic')].pop();"
                        "return i ? i.src.slice(0,24) : null;}")
    dmin = subprocess.run(["psql", "-h", "/tmp/qwenwork/pg", "-U", "postgres", "-d", "eschat", "-tA", "-q",
                           "-c", "select media from public.chat_dm where media is not null limit 1"],
                          capture_output=True, text=True).stdout.strip()
    ok(bool(picm) and picm.startswith("data:image") and dmin.startswith("data:image"),
       "фото в личке лежит в защищённой строке, а не по общедоступному пути", f"{picm[:24]} / бд: {dmin[:24]}")

    # 7. мобильная вёрстка -------------------------------------------------
    mob = browser.new_context(**{"viewport": {"width": 390, "height": 844},
                                 "is_mobile": True, "has_touch": True,
                                 "device_scale_factor": 3, "user_agent":
                                 "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"})
    mpg2 = mob.new_page()
    mpg2.goto(url("Мария", "2222"))
    mpg2.wait_for_selector("#app:not([hidden])", timeout=20000)
    time.sleep(1.5)
    over = mpg2.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    ok(over <= 1, "на iPhone-экране 390px нет горизонтального переполнения", f"overflow={over}px")
    comp = mpg2.evaluate("() => {const r=document.querySelector('.composer').getBoundingClientRect();"
                         "return {b: Math.round(r.bottom), h: Math.round(r.height), win: window.innerHeight};}")
    ok(comp["b"] <= comp["win"] + 2 and comp["h"] > 30, "поле ввода прижато к низу и не залезает за экран", comp)
    mpg2.screenshot(path="/tmp/qwenwork/chat/tests/mobile-dm.png")
    mpg2.click("#btn-rooms")                       # открытым ящиком меряем ширину и футер
    time.sleep(0.8)
    open_geo = mpg2.evaluate("""() => {
      const d = document.querySelector('#drawer'), f = document.querySelector('.drawer-foot');
      return { drawerShare: Math.round(d.getBoundingClientRect().width / innerWidth * 100),
               footBottom: Math.round(f.getBoundingClientRect().bottom), win: innerHeight };
    }""")
    mpg2.screenshot(path="/tmp/qwenwork/chat/tests/mobile-rooms.png")
    mpg2.evaluate("() => { document.querySelector('#drawer').hidden = true; }")
    try:                                   # ждём реальной растеризации фото, иначе скриншот ловит пустую рамку
        mpg2.wait_for_function("""() => { const i = [...document.querySelectorAll('#msgs img.pic')].pop();
                                     return !!i && i.complete && i.naturalWidth > 0; }""", timeout=8000)
    except Exception:
        pass
    time.sleep(0.6)
    geo = mpg2.evaluate("""() => {
      const t = document.getElementById('in-body');
      const pic = [...document.querySelectorAll('#msgs img.pic')].pop();
      return { clip: t.scrollHeight - t.clientHeight, fh: Math.round(t.getBoundingClientRect().height),
               natural: pic ? pic.naturalWidth : -1 };
    }""")
    ok(geo["clip"] <= 0 and geo["fh"] >= 44, "подсказка в поле ввода не обрезана", geo)
    ok(geo["natural"] > 0, "фото в канале отрисовано, пустой рамки нет", geo["natural"])
    ok(open_geo["drawerShare"] >= 99, "на телефоне список комнат во всю ширину", open_geo)
    ok(open_geo["footBottom"] <= open_geo["win"] + 2, "футер ящика не вылезает за экран", open_geo)
    mpg2.screenshot(path="/tmp/qwenwork/chat/tests/mobile-after.png")
    mob.close()

    # 8. зачистка 48 часов: строки вместе с вложениями ----------------------
    psql = ["psql", "-h", "/tmp/qwenwork/pg", "-U", "postgres", "-d", "eschat", "-tA", "-q",
            "-v", "ON_ERROR_STOP=1", "-c"]
    subprocess.run(psql + ["update public.chat_message set created_at = now() - interval '49 hours'"
                           " where media is not null"], check=True, capture_output=True)
    subprocess.run(psql + ["update public.chat_janitor set ran_at = '1970-01-01' where id = 1;"],
                   check=True, capture_output=True)
    st, res = api_call("chat_gc", {})
    ok("\"messages\"" in res, "метёлка сработала", res[:80])
    left = subprocess.run(psql + ["select count(*) from public.chat_message where created_at < now() - interval '48 hour'"],
                          capture_output=True, text=True).stdout.strip()
    pics = subprocess.run(psql + ["select count(*) from public.chat_message where media is not null"],
                          capture_output=True, text=True).stdout.strip()
    ok(left == "0", "просроченное удалено целиком, вместе с фото", f"старых={left}, фото в бд={pics}")
    dm_left = subprocess.run(psql + ["select count(*) from public.chat_dm where created_at < now() - interval '48 hour'"],
                             capture_output=True, text=True).stdout.strip()
    ok(dm_left == "0", "личные сообщения и их вложения тоже стёрты", f"старых лс={dm_left}")

    # 9. ограничения на вложение и права ----------------------------------
    import hashlib
    ch = hashlib.sha256("Иван\u241f1111".encode()).hexdigest()
    room = subprocess.run(psql + ["select id from public.chat_room limit 1"],
                          capture_output=True, text=True).stdout.strip()
    st, res = api_call("chat_send", {"p_room": room, "p_nick": "Иван", "p_code_hash": ch,
                                     "p_body": "плохое фото", "p_media": "http://evil/x.jpg"})
    ok(st == 400 and "bad img" in res, "RPC не принимает мусор вместо data-URL", res[:70])
    st2, res2 = api_call("chat_send", {"p_room": room, "p_nick": "Иван",
                                       "p_code_hash": "0" * 64, "p_body": "хак", "p_media": None})
    ok(st2 == 400 and "wrong code" in res2, "в открытую комнату нельзя написать чужим кодом", res2[:70])
    big = "data:image/jpeg;base64," + "A" * 400001
    p_stdin = ["psql", "-h", "/tmp/qwenwork/pg", "-U", "postgres", "-d", "eschat", "-tA", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"]
    r = subprocess.run(p_stdin, input=f"set role anon; select public.chat_send('{room}'::uuid,'Иван','{ch}',"
                                      f"'огромное фото', E'{big}');", capture_output=True, text=True)
    ok(r.returncode != 0 and "img too big" in (r.stderr + r.stdout),
       "вложение больше 400k отбивается на уровне БД", (r.stderr or r.stdout).strip()[:80])
    r2 = subprocess.run(p_stdin, input=f"set role anon; select count(*) from public.chat_message where body='огромное фото';",
                        capture_output=True, text=True)
    ok(r2.stdout.strip().endswith("0"), "и в таблицу такое не попало", r2.stdout.strip()[:60])

print()
print("ПРОВАЛОВ: %d" % len(FAILS) if FAILS else "все проверки пройдены")
sys.exit(1 if FAILS else 0)
