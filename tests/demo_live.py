# -*- coding: utf-8 -*-
"""Проверка демо-режима на уже опубликованной странице (без Supabase)."""
import time
import urllib.request
from playwright.sync_api import sync_playwright

EX = "/opt/playwright-browsers/chromium-1209/chrome-linux64/chrome"
PAGE = "https://pafnusha.github.io/es-chat/?demo=1"
fails = []


def ok(cond, name, extra=""):
    print(("PASS  " if cond else "FAIL  ") + name + ((" :: " + str(extra)) if extra else ""), flush=True)
    if not cond:
        fails.append(name)


d = __import__("json").dumps
req = urllib.request.Request("https://raw.githubusercontent.com/Pafnusha/es-chat/main/js/app.js")
src = urllib.request.urlopen(req, timeout=30).read().decode()
ok("./demo.js" in src and "showSetup" in src, "на GitHub Pages лежит версия с демо-режимом")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EX)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: print("   ! pageerror:", str(e)[:200]))
    pg.goto(PAGE)
    pg.wait_for_timeout(3000)
    ok(pg.is_visible("#login"), "экран входа показан без конфига Supabase", pg.inner_text("h1"))
    pg.fill("#in-nick", "Демо-Иван")
    pg.fill("#in-code", "тест-код")
    pg.click("#btn-login")
    pg.wait_for_timeout(2500)
    ok(pg.is_visible("#app"), "вход в демо-режим прошёл")
    ok(pg.is_visible("#demo-flag") and "демо" in pg.inner_text("#demo-flag"),
       "интерфейс честно помечен как демо", pg.inner_text("#demo-flag"))
    ok("ЭС-общий" in pg.inner_text("#room-list"), "демо-каналы видны", pg.inner_text("#room-list")[:50])
    pg.wait_for_selector("#room-list li", timeout=8000)
    pg.locator("#room-list li").first.click()
    pg.wait_for_timeout(800)
    pg.fill("#in-body", "Проверяем демо на живом GitHub Pages")
    pg.click(".send")
    pg.wait_for_timeout(2500)
    ok("демо на живом" in pg.inner_text("#msgs"), "сообщение появилось в ленте", pg.inner_text("#msgs")[-60:])
    ttl = pg.locator("#msgs .ttl").last.inner_text()
    ok("48" in ttl, "счётчик до самоуничтожения работает", ttl)
    pg.set_input_files("#in-file", "/tmp/qwenwork/chat/tests/fixture.png")
    pg.wait_for_timeout(2500)
    pg.click(".send")
    pg.wait_for_timeout(2500)
    pic = pg.evaluate("() => {const i=[...document.querySelectorAll('#msgs img.pic')].pop(); return i?{w:i.naturalWidth,src:i.src.slice(0,20)}:null;}")
    ok(bool(pic) and pic["w"] > 0, "фото в демо приложилось и отрисовалось", pic)
    pg.evaluate("() => {const c=new BroadcastChannel('eschat.demo');}")
    ctx2 = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg2 = ctx2.new_page()
    pg2.goto(PAGE)
    pg2.wait_for_timeout(2500)
    pg2.fill("#in-nick", "Демо-Мария")
    pg2.fill("#in-code", "другой-код")
    pg2.click("#btn-login")
    pg2.wait_for_timeout(2000)
    pg2.locator("#room-list li").first.click()
    pg2.wait_for_timeout(2500)
    ok("демо на живом" in pg2.inner_text("#msgs"), "вторая вкладка этого же браузера видит ленту",
       pg2.inner_text("#msgs")[-60:])
    if pg2.eval_on_selector("#drawer", "e=>e.hidden"):
        pg2.click("#btn-rooms")
    pg2.wait_for_selector("#drawer:not([hidden])", timeout=8000)
    pg2.click('.drawer-tabs button[data-tab="dm"]')
    pg2.wait_for_timeout(600)
    pg2.click("#btn-newroom")
    pg2.fill("#dm-peer", "Демо-Иван")
    pg2.click("#dm-ok")
    pg2.fill("#in-body", "лично, в демо тоже по коду")
    pg2.click(".send")
    pg2.wait_for_timeout(2500)
    ok("лично, в демо" in pg2.inner_text("#msgs"), "личка в демо работает")
    pg2.screenshot(path="/tmp/qwenwork/demo_live.png")
    b.close()

print()
print("ПРОВАЛОВ: %d" % len(fails) if fails else "демо на GitHub Pages живое")
exit(1 if fails else 0)
