from playwright.sync_api import sync_playwright

EX = "/opt/playwright-browsers/chromium-1209/chrome-linux64/chrome"
U = ("http://127.0.0.1:4173/index.html?su=http://127.0.0.1:8123&sk=test-anon-key"
     "&n=%D0%98%D0%B2%D0%B0%D0%BD&c=1111")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EX)
    pg = b.new_page()
    pg.on("console", lambda m: print("C:", m.type, m.text[:200]))
    pg.on("pageerror", lambda e: print("PE:", str(e)[:250]))
    pg.on("response", lambda r: print("R:", r.status, r.request.method, r.url[-52:]) if "storage" in r.url or "chat_send" in r.url else None)
    pg.goto(U)
    pg.wait_for_timeout(2200)
    pg.locator("#room-list li").first.click()
    pg.wait_for_timeout(600)
    print("active:", pg.inner_text("#room-title"))
    pg.set_input_files("#in-file", "/tmp/qwenwork/chat/tests/fixture.png")
    pg.wait_for_timeout(2500)
    print("pending:", pg.inner_text("#pending")[:120])
    print("hidden?", pg.eval_on_selector("#pending", "e=>e.hidden"))
    pg.click(".send")
    pg.wait_for_timeout(2500)
    print("imgs:", pg.evaluate("()=>[...document.querySelectorAll('#msgs img.pic')].map(i=>i.src.slice(0,60))"))
    b.close()
