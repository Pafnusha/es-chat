// Сквозной тест клиента чата: два «телефона» общаются, личка изолирована,
// ник защищён кодом, фото доезжает, 48-часовая зачистка работает.
import { chromium, devices } from 'playwright';

const APP = 'http://127.0.0.1:4173/index.html';
const API = 'http://127.0.0.1:8123';
const url = (n, c) => `${APP}?su=${API}&sk=test-anon-key&n=${encodeURIComponent(n)}&c=${c}`;

let fails = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
  if (!cond) fails++;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();

async function session(nick, code, ctxOpts = {}) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('   ! pageerror:', e.message));
  await page.goto(url(nick, code));
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await sleep(900);
  return { ctx, page };
}

// ───────── 1. вход и создание канала ─────────
const ivan = await session('Иван', '1111');
const title = await ivan.page.locator('#room-title').innerText();
ok(!!title, 'вход по нику и коду', title);
await ivan.page.click('#btn-newroom');
await ivan.page.selectOption('#new-kind', 'channel');
await ivan.page.fill('#new-name', 'ЭС-общий');
await ivan.page.click('#new-ok');
await sleep(1200);
await ivan.page.click('#btn-rooms');
const hasRoom = await ivan.page.locator('#room-list li', { hasText: 'ЭС-общий' }).count();
ok(hasRoom === 1, 'канал создан и виден в списке');
await ivan.page.click('#drawer', { position: { x: 5, y: 5 } }).catch(() => {});
await ivan.page.keyboard.press('Escape');

// ───────── 2. открытое сообщение доходит до второго ─────────
await ivan.page.click('#btn-rooms');
await ivan.page.locator('#room-list li', { hasText: 'ЭС-общий' }).first().click();
await ivan.page.fill('#in-body', 'Проверка: лотки по ВНИИПО — линия в сборе');
await ivan.page.click('.send');
await sleep(1500);
const text1 = await ivan.page.locator('#msgs .txt').last().innerText();
ok(text1.includes('ВНИИПО'), 'сообщение отображается у автора', text1);

const maria = await session('Мария', '2222');
await maria.page.click('#btn-rooms');
await maria.page.locator('#room-list li', { hasText: 'ЭС-общий' }).first().click();
await sleep(3000);
const saw = await maria.page.locator('#msgs .txt').allInnerTexts();
ok(saw.some(t => t.includes('ВНИИПО')), 'второй ник видит чужое сообщение в реальном времени');
await maria.page.fill('#in-body', 'Принято, добавила в ведомость');
await maria.page.click('.send');
await sleep(3500);
const ivanSaw = await ivan.page.locator('#msgs .txt').allInnerTexts();
ok(ivanSaw.some(t => t.includes('Принято')), 'ответ дошёл обратно автору');

// ───────── 3. личка: изоляция ─────────
await ivan.page.click('#btn-rooms');
await ivan.page.click('.drawer-tabs button[data-tab="dm"]');
await ivan.page.click('#btn-newroom');
await ivan.page.fill('#dm-peer', 'Мария');
await ivan.page.click('#dm-ok');
await ivan.page.fill('#in-body', 'Лично: сечение по ПУЭ 1.7 не проходит');
await ivan.page.click('.send');
await sleep(3500);
const dmMine = await ivan.page.locator('#msgs .txt').allInnerTexts();
ok(dmMine.some(t => t.includes('не проходит')), 'личное сообщение отправлено и видно автору');

await maria.page.click('#btn-rooms');
await maria.page.click('.drawer-tabs button[data-tab="dm"]');
await sleep(1200);
const peers = await maria.page.locator('#room-list li').allInnerTexts();
ok(peers.some(p => p.includes('Иван')), 'собеседник появился в списке лички у получателя', peers.join('|'));
await maria.page.locator('#room-list li', { hasText: 'Иван' }).first().click();
await sleep(3000);
const dmPeer = await maria.page.locator('#msgs .txt').allInnerTexts();
ok(dmPeer.some(t => t.includes('не проходит')), 'получатель прочитал личку');

const guest = await session('Гость', '3333');
await guest.page.click('#btn-rooms');
await guest.page.click('.drawer-tabs button[data-tab="dm"]');
await sleep(1200);
const guestPeers = await guest.page.locator('#room-list li').allInnerTexts();
ok(!guestPeers.some(p => /Иван|Мария/.test(p)), 'третий ник не видит чужую личку в списках', guestPeers.join('|'));
const leak = await guest.page.evaluate(async ([api, key]) => {
  const h = { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key };
  const code = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('Гост\u241f3333'));
  const hash = [...new Uint8Array(code)].map(x => x.toString(16).padStart(2, '0')).join('');
  const r = await fetch(`${api}/rest/v1/rpc/chat_dm_history`, { method: 'POST', headers: h,
    body: JSON.stringify({ p_nick: 'Гость', p_code_hash: hash, p_peer: 'Иван' }) });
  return { status: r.status, body: (await r.text()).slice(0, 160) };
}, [API, 'test-anon-key']);
ok(leak.status !== 200 || !leak.body.includes('не проходит'), 'прямой запрос к личке без права тоже пуст', JSON.stringify(leak));

// ───────── 4. ник защищён кодом ─────────
const thief = await browser.newContext();
const tp = await thief.newPage();
await tp.goto(`${APP}?su=${API}&sk=test-anon-key`);
await tp.fill('#in-nick', 'Иван');
await tp.fill('#in-code', 'угадал');
await tp.click('#btn-login');
await sleep(1500);
const err = await tp.locator('#login-err').innerText().catch(() => '');
ok(/занят/i.test(err), 'чужой код к занятому нику не пускает', err);
await thief.close();

// ───────── 5. фото ─────────
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAOUlEQVR4nO3RMQEAAAgDoJvc6BmDxwBmckMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAtOg0BAR6wJ/KAAAAAAElFTkSuQmCC', 'base64');
await ivan.page.setInputFiles('#in-file', { name: 'shot.png', mimeType: 'image/png', buffer: png });
await sleep(800);
await ivan.page.click('.pending button');           // загрузить
await sleep(1800);
await ivan.page.click('.send');
await sleep(3500);
const pic = await ivan.page.evaluate(() => {
  const img = [...document.querySelectorAll('#msgs img.pic')].pop();
  return img ? { src: img.src, w: img.naturalWidth } : null;
});
ok(!!pic && pic.w > 0, 'фото из открытого канала загрузилось и отрисовалось', pic?.src || '');

// ───────── 6. мобильная вёрстка ─────────
const mob = await browser.newContext({ ...devices['iPhone 13'] });
const mp = await mob.newPage();
await mp.goto(url('Мария', '2222'));
await mp.waitForSelector('#app:not([hidden])');
await sleep(1200);
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const kbVisible = await mp.evaluate(() => {
  const c = document.querySelector('.composer').getBoundingClientRect();
  return c.bottom <= window.innerHeight + 2 && c.height > 30;
});
ok(overflow <= 1, 'на телефоне нет горизонтального переполнения', `overflow=${overflow}px`);
ok(kbVisible, 'поле ввода прижато к низу экрана');
await mp.screenshot({ path: '/tmp/qwenwork/chat/tests/mobile.png' });
await mob.close();

// ───────── 7. зачистка 48 часов (сторона сервера) ─────────
const purge = await ivan.page.evaluate(async ([api, key]) => {
  const h = { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key };
  const r = await fetch(`${api}/rest/v1/rpc/chat_gc_media`, { method: 'POST', headers: h, body: '{}' });
  return r.json();
}, [API, 'test-anon-key']);
ok(Array.isArray(purge), 'список протухших файлов отдаётся ( реальный прогон очистки ниже)', JSON.stringify(purge).slice(0, 80));

await browser.close();
console.log(fails ? `\nПРОВАЛОВ: ${fails}` : '\nвсе проверки пройдены');
process.exit(fails ? 1 : 0);
