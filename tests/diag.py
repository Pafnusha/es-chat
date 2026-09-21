from playwright.sync_api import sync_playwright

EX = "/opt/playwright-browsers/chromium-1209/chrome-linux64/chrome"
A = "a" * 64
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EX)
    pg = b.new_page()
    pg.on("console", lambda m: print("console:", m.type, m.text[:250]))
    pg.on("pageerror", lambda e: print("pageerror:", str(e)[:400]))
    pg.on("requestfailed", lambda r: print("reqfail:", r.url[:140], r.failure))
    pg.on("response", lambda r: r.url.endswith(("chat_auth", "chat_online", "chat_room", "chat_message"))
          and print("resp", r.status, r.url[-60:]))
    pg.goto("http://127.0.0.1:4173/index.html?su=http://127.0.0.1:8123&sk=test-anon-key&n=%D0%A2%D0%B5%D1%81%D1%82&c=1111")
    pg.wait_for_timeout(4000)
    print("login hidden?", pg.eval_on_selector("#login", "e=>e.hidden"))
    print("app hidden?", pg.eval_on_selector("#app", "e=>e.hidden"))
    print("err:", pg.inner_text("#login-err") if pg.is_visible("#login-err") else "(нет)")
    print("title:", pg.inner_text("#room-title"))
    b.close()
