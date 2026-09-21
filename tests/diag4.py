# -*- coding: utf-8 -*-
"""Визуальная диагностика мобильного экрана: поле ввода, картинка, ширина ящика."""
import subprocess
import time
from playwright.sync_api import sync_playwright

EX = "/opt/playwright-browsers/chromium-1209/chrome-linux64/chrome"
psql = ["psql", "-h", "/tmp/qwenwork/pg", "-U", "postgres", "-d", "eschat", "-tA", "-q", "-c"]
subprocess.run(psql + ["update public.chat_janitor set ran_at = '1970-01-01'"], capture_output=True)
room = subprocess.run(psql + ["select id from public.chat_room limit 1"], capture_output=True, text=True).stdout.strip()
code = subprocess.run(["python3", "-c", "import hashlib;print(hashlib.sha256('Иван\\u241f1111'.encode()).hexdigest())"],
                      capture_output=True, text=True).stdout.strip()
sql = f"select public.chat_send('{room}'::uuid,'Иван','{code}','скрин подстанции', " \
      f"'data:image/png;base64,'||encode(decode(repeat('89504E470D0A1A0A0000000D49484452000000A00000007"
sql += " 80200000061DC185F0000001949444154785E6881EDD13101000000C2A0F7M','hex'),'base64'), 'base64') from public.chat_room limit 1;"
subprocess.run(psql + [f"select public.chat_send('{room}'::uuid,'Иван','{code}','скрин подстанции',null)"], capture_output=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EX)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                        device_scale_factor=2)
    pg = ctx.new_page()
    pg.goto("http://127.0.0.1:4173/index.html?su=http://127.0.0.1:8123&sk=test-anon-key"
            "&n=%D0%9C%D0%B0%D1%80%D0%B8%D1%8F&c=2222")
    pg.wait_for_selector("#app:not([hidden])", timeout=20000)
    time.sleep(2.5)
    pg.locator("#room-list li").first.click()
    time.sleep(2.0)
    print(pg.evaluate("""() => {
      const t=document.getElementById('in-body'), r=t.getBoundingClientRect();
      const pic=[...document.querySelectorAll('#msgs img.pic')].pop();
      const drawer=document.querySelector('#drawer');
      return { field:{h:Math.round(r.height), clipLines:t.scrollHeight-t.clientHeight},
               pic: pic ? {w:Math.round(pic.getBoundingClientRect().width), natural: pic.naturalWidth+'x'+pic.naturalHeight} : 'нет картинок',
               drawerW: Math.round(drawer.getBoundingClientRect().width), win: innerWidth };
    }"""))
    pg.screenshot(path="tests/mobile-after.png")
    pg.click("#btn-rooms")
    time.sleep(0.8)
    pg.screenshot(path="tests/mobile-rooms2.png")
    b.close()
