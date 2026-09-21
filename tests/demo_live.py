# -*- coding: utf-8 -*-
"""Проверка демо-режима на уже опубликованной странице GitHub Pages (без Supabase)."""
import json
import time
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright

EX = "/opt/playwright-browsers/chromium-1209/chrome-linux64/chrome"
PAGE = "https://pafnusha.github.io/es-chat/?demo=1"
FAILS = []


def ok(cond, name, extra=""):
    print(("PASS  " if cond else "FAIL  ") + name + ((" :: " + str(extra)) if extra else ""), flush=True)
    if not cond:
        FAILS.append(name)


def open_drawer(pg):
    if pg.eval_on_selector("#drawer", "e => e.hidden"):
        pg.click("#btn-rooms")
    pg.wait_for_selector("#drawer:not([hidden])", timeout=8000)


def pick_room(pg, name):
    open_drawer(pg)
    pg.locator("#room-list li", has_text=name).first.click()
    time.sleep(1.2)


def login(pg, nick, code):
    pg.goto(PAGE)
    pg.wait_for_selector("#login:not([hidden])", timeout=20000)
    pg.fill("#in-nick", nick)
    pg.fill("#in-code", code)
    pg.click("#btn-login")
    pg.wait_for_selector("#app:not([hidden])", timeout=20000)
    time.sleep(1.5)


raw = urllib.request.urlopen("https://raw.githubusercontent.com/Pafnusha/es-chat/main/js/app.js", timeout=30).read().decode()
ok("./demo.js" in raw and "showSetup" in raw, "на GitHub Pages лежит версия с демо-режимом")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EX)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: print("   ! pageerror:", str(e)[:200]))
    login(pg, "Демо-Иван", "тест-код")
    ok(pg.is_visible("#demo-flag"), "интерфейс честно помечен как демо", pg.inner_text("#demo-flag"))
    open_drawer(pg)
    ok("ЭС-общий" in pg.inner_text("#room-list"), "демо-каналы видны", pg.inner_text("#room-list")[:40])
    pick_room(pg, "ЭС-общий")
    pg.fill("#in-body", "Проверяем демо на живом GitHub Pages")
    pg.click(".send")
    time.sleep(2.5)
    ok("демо на живом" in pg.inner_text("#msgs"), "сообщение появилось в ленте")
    ok("48" in pg.locator("#msgs .ttl").last.inner_text(), "счётчик до самоуничтожения работает",
       pg.locator("#msgs .ttl").last.inner_text())

    pg.set_input_files("#in-file", "/tmp/qwenwork/chat/tests/fixture.png")
    time.sleep(2.0)
    pg.click(".send")
    time.sleep(2.5)
    pic = pg.evaluate("() => {const i=[...document.querySelectorAll('#msgs img.pic')].pop();"
                      "return i ? {w: i.naturalWidth, src: i.src.slice(0,20)} : null;}")
    ok(bool(pic) and pic["w"] > 0, "фото в демо приложилось и отрисовалось", pic)

    # личка в демо тоже по коду
    open_drawer(pg)
    pg.click('.drawer-tabs button[data-tab="dm"]')
    time.sleep(0.8)
    pg.click("#btn-newroom")
    pg.fill("#dm-peer", "Демо-Мария")
    pg.click("#dm-ok")
    time.sleep(1.0)
    pg.fill("#in-body", "лично, но и в демо по коду")
    pg.click(".send")
    time.sleep(2.0)
    ok("лично, но и в демо" in pg.inner_text("#msgs"), "личка в демо работает")

    # вторая вкладка того же браузера = второй человек (демо делит localStorage, а не сеть)
    pg2 = ctx.new_page()
    login(pg2, "Демо-Мария", "свой-код")
    ok(pg2.is_visible("#demo-flag"), "демо-плашка и во второй вкладке")
    time.sleep(1.0)
    pick_room(pg2, "ЭС-общий")
    ok("демо на живом" in pg2.inner_text("#msgs"), "вторая вкладка того же браузера видит общую ленту")
    open_drawer(pg2)
    pg2.click('.drawer-tabs button[data-tab="dm"]')
    time.sleep(0.8)
    ok("Демо-Иван" in pg2.inner_text("#room-list"), "собеседник появился в списке лички",
       pg2.inner_text("#room-list")[:60])
    pg2.locator("#room-list li", has_text="Демо-Иван").first.click()
    time.sleep(1.5)
    ok("лично, но и в демо" in pg2.inner_text("#msgs"), "адресат прочитал адресованное ему сообщение")
    # третья вкладка: чужой код не знает — чужую личку не видит
    pg3 = ctx.new_page()
    login(pg3, "Демо-Гость", "иной-код")
    open_drawer(pg3)
    pg3.click('.drawer-tabs button[data-tab="dm"]')
    time.sleep(0.8)
    lst = pg3.inner_text("#room-list")
    ok("Демо-Иван" not in lst and "Демо-Мария" not in lst, "в демо чужую личку тоже не подглядеть", lst[:50])
    pg2.screenshot(path="/tmp/qwenwork/demo_live.png")
    b.close()

print()
print("ПРОВАЛОВ: %d" % len(FAILS) if FAILS else "демо на GitHub Pages живое")
raise SystemExit(1 if FAILS else 0)
