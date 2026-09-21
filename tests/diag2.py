from playwright.sync_api import sync_playwright

EX = "/opt/playwright-browsers/chromium-1209/chrome-linux64/chrome"
U = ("http://127.0.0.1:4173/index.html?su=http://127.0.0.1:8123&sk=test-anon-key"
     "&n=%D0%98%D0%B2%D0%B0%D0%BD&c=1111")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EX)
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    pg.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:300]))
    pg.goto(U)
    pg.wait_for_timeout(2500)
    print(pg.evaluate("""() => {
      const q=(s)=>{const e=document.querySelector(s); if(!e) return s+': НЕТ';
        const r=e.getBoundingClientRect(), cs=getComputedStyle(e);
        return `${s}: ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} disp=${cs.display} vis=${cs.visibility} op=${cs.opacity} hidden=${e.hidden}`;};
      return [q('#drawer'), q('#btn-newroom'), q('.drawer-foot'), q('#dlg-new'), q('#new-ok'), q('#msgs'), q('.composer'), q('#app'), q('.pane')].join('\\n');
    }"""))
    pg.screenshot(path="/tmp/qwenwork/chat/tests/diag.png")
    b.close()
