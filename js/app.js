let api = null;
const wantDemo = () => localStorage.getItem('eschat.demo') === '1' || new URLSearchParams(location.search).get('demo') === '1';
const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('eschat.' + k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem('eschat.' + k, JSON.stringify(v)),
};
const me = { nick: '', hash: '' };
let rooms = [], dms = [];
let active = LS.get('active', null);
let shown = new Map(), lastId = 0, pollTimer = null, sweeping = 0;
let draft = null;
let calls = null;
const TTL = 48 * 3600 * 1000;
const fmtDay = (ts) => {
  const d = new Date(ts), t = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === t.toDateString()) return 'сегодня';
  if (d.toDateString() === y.toDateString()) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};
const hhmm = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const left = (ts) => {
  const h = Math.ceil((+ts + TTL - Date.now()) / 3600e3);
  return h <= 0 ? 'истёк' : `осталось ${h > 47 ? '≈48' : h} ч`;
};
function toast(text, ms = 3200) {
  const t = el('div', 'toast', text); document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
function showLogin(err) {
  $('#login').hidden = false; $('#app').hidden = true;
  const box = $('#login-err');
  box.hidden = !err; box.textContent = err || '';
  if (err) $('#btn-login').insertAdjacentElement('afterend', box);
}
async function login() {
  const nick = $('#in-nick').value.trim(), code = $('#in-code').value;
  if (nick.length < 2) return showLogin('Ник от 2 символов.');
  if (code.length < 4) return showLogin('Код от 4 символов — это ключ к твоей личке.');
  const hash = await api.codeHash(nick, code);
  const res = await api.rpc('chat_auth', { p_nick: nick, p_code_hash: hash }).catch(e => ({ error: String(e.message) }));
  const r = Array.isArray(res) ? res[0] : res;
  if (!r?.ok) {
    const why = r?.error === 'nick_taken' ? 'Такой ник уже занят и закреплён другим кодом. Возьми другой ник.'
      : r?.error === 'unknown' ? 'соединение с сервером потеряно' : 'Не вошло: ' + (r?.error || 'сервер не ответил');
    return showLogin(why);
  }
  sessionStorage.setItem('eschat.me', JSON.stringify({ nick, code, hash }));
  me.nick = nick; me.hash = hash;
  await enter();
}
async function loadRooms() {
  const [rs, dm] = await Promise.all([
    api.rooms().catch(() => []),
    api.rpc('chat_dm_peers', { p_nick: me.nick, p_code_hash: me.hash }).catch(() => []),
  ]);
  rooms = Array.isArray(rs) ? rs : [];
  dms = Array.isArray(dm) ? dm : [];
  if (!active && rooms.length) active = { kind: 'room', id: rooms[0].id, name: rooms[0].name };
  renderRooms();
}
function toggleDrawer(open) {
  $('#drawer').hidden = !open;
  $('#scrim').hidden = !open || matchMedia('(min-width: 860px)').matches;
}
function renderRooms() {
  const tab = $('.drawer-tabs .on').dataset.tab;
  const list = $('#room-list'); list.innerHTML = '';
  const src = tab === 'dm' ? dms.map(d => ({ key: 'dm:' + d.peer, name: d.peer, meta: null, badge: d.recent_48h, kind: 'dm' }))
    : rooms.filter(r => r.kind === tab).map(r => ({ key: 'room:' + r.id, name: r.name, meta: r.kind === 'group' ? 'группа' : 'канал', kind: tab, id: r.id }));
  if (!src.length) list.append(el('li', 'sys', tab === 'dm' ? 'Личных пока нет — напиши первому.' : 'Пусто. Создай внизу.'));
  for (const it of src) {
    const li = el('li'); const nm = el('span', 'nm', it.name); li.append(nm);
    if (it.meta) li.append(el('span', 'mt', it.meta));
    if (it.badge) li.append(el('span', 'badge', String(it.badge)));
    const isActive = (it.kind === 'dm' && active?.kind === 'dm' && active.name === it.name)
      || (it.kind !== 'dm' && active?.kind === 'room' && active.id === it.id);
    li.classList.toggle('on', !!isActive);
    li.onclick = () => {
      active = it.kind === 'dm' ? { kind: 'dm', name: it.name } : { kind: 'room', id: it.id, name: it.name };
      LS.set('active', active); shown = new Map(); lastId = 0; toggleDrawer(false);
      renderRooms(); startPoll(); paint();
    };
    list.append(li);
  }
  $('#room-title').textContent = active?.name || 'выберите комнату';
  calls?.syncButtons();
}
function bubble(m) {
  const li = el('li', m.author === me.nick ? 'me' : '');
  const b = el('div', 'bub');
  if (m.author !== me.nick) b.append(el('div', 'who', m.author));
  if (m.body) b.append(el('div', 'txt', m.body));
  if (m.media) {
    const img = el('img', 'pic'); img.src = api.mediaUrl(m.media); img.alt = 'вложение';
    img.decoding = 'async';
    img.onerror = () => img.remove();
    img.onclick = () => { $('#lightbox').hidden = false; $('#lightbox img').src = img.src; };
    b.append(img);
  }
  const meta = el('div', 'meta');
  meta.append(el('span', null, hhmm(new Date(m.created_at))));
  meta.append(el('span', 'ttl', left(new Date(m.created_at))));
  b.append(meta); li.append(b); return li;
}
function paint() {
  const box = $('#msgs'); const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  const arr = [...shown.values()].sort((a, b) => a.id - b.id);
  box.innerHTML = '';
  let day = null;
  for (const m of arr) {
    const d = fmtDay(new Date(m.created_at));
    if (d !== day) { day = d; const w = el('li', 'day'); w.append(el('span', null, d)); box.append(w); }
    box.append(bubble(m));
  }
  if (!arr.length) { const w = el('li', 'sys'); w.append(el('div', 'bub', 'Пока тихо. Напиши первым — через 48 часов запись исчезнет.')); box.append(w); }
  if (atBottom) box.scrollTop = box.scrollHeight; else $('#jump').hidden = false;
  box.onscroll = () => {
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 90) $('#jump').hidden = true;
  };
  const sub = active?.kind === 'dm' ? 'лично · видно только вам двоим'
    : (rooms.find(r => String(r.id) === String(active?.id))?.kind === 'group' ? 'группа · открыто для всех' : 'канал · открыто для всех');
  $('#room-sub').textContent = `${sub} · ${arr.length} за 48 ч`;
}
let pulls = 0;
async function pull() {
  if (!active) return;
  if (++pulls % 6 === 0) loadRooms();
  try {
    let rows = [];
    const head = shown.size ? Math.max(...shown.keys()) : null;
    if (active.kind === 'room') rows = await api.roomMessages(active.id, head);
    else rows = await api.rpc('chat_dm_history', { p_nick: me.nick, p_code_hash: me.hash, p_peer: active.name, p_before: null, p_limit: 120 }) || [];
    let grew = false;
    for (const m of rows) if (!shown.has(m.id)) { shown.set(m.id, m); grew = true; }
    if (grew) { if (active.kind === 'dm') { const max = Math.max(...[...shown.keys()]); lastId = max; } paint(); }
  } catch (e) {}
  if (Date.now() - sweeping > 4 * 60e3) { sweeping = Date.now(); api.sweep().catch(() => {}); }
}
function startPoll() {
  clearInterval(pollTimer);
  if (!active) return;
  pull();
  pollTimer = setInterval(pull, document.hidden ? 9000 : 2200);
}
document.addEventListener('visibilitychange', () => { if (!me.nick) return; startPoll(); });
async function send() {
  if (!active) return toast('Сначала выбери комнату слева.');
  const body = $('#in-body').value.trim();
  const media = draft?.data || null;
  if (!body && !media) return;
  $('#in-body').value = ''; grow();
  const btn = $('.send'); btn.disabled = true;
  try {
    if (active.kind === 'room') await api.rpc('chat_send', { p_room: active.id, p_nick: me.nick, p_code_hash: me.hash, p_body: body, p_media: media });
    else await api.rpc('chat_dm_send', { p_nick: me.nick, p_code_hash: me.hash, p_peer: active.name, p_body: body, p_media: media });
    draft = null; renderDraft();
    await pull();
    $('#msgs').scrollTop = $('#msgs').scrollHeight;
  } catch (e) { toast('Не ушло: ' + e.message); $('#in-body').value = body; }
  finally { btn.disabled = false; $('#in-body').focus(); }
}
async function fileToBlob(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bmp) return file.type.startsWith('image/') ? file : null;
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.82));
}
async function shrink(blob, w, q) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, w / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b || blob), 'image/jpeg', q));
}
async function attach(file) {
  let blob = await fileToBlob(file);
  if (!blob) return toast('Не картинка или формат не читается.');
  for (const [w, q] of [[1600, .82], [1400, .78], [1150, .72], [950, .66], [800, .6], [640, .55]]) {
    if (blob.size * 1.37 < api.maxChars - 4000) break;
    blob = await shrink(blob, w, q);
  }
  if (blob.size * 1.37 > api.maxChars) return toast('Картинка не сжимается до нужного размера — возьми скрин поменьше.');
  draft = { blob, data: await api.dataUrl(blob), url: URL.createObjectURL(blob) };
  renderDraft();
}
function renderDraft() {
  const p = $('#pending');
  if (!draft) { p.hidden = true; p.innerHTML = ''; return; }
  p.hidden = false; p.innerHTML = '';
  const img = el('img'); img.src = draft.url; p.append(img);
  p.append(el('span', null, 'приложится к сообщению · ' + Math.max(1, Math.round(draft.blob.size / 1024)) + ' КБ'));
  const x = el('button', 'x', 'убрать'); x.type = 'button'; x.onclick = () => { draft = null; renderDraft(); };
  p.append(x);
}
function grow() {
  const t = $('#in-body'); t.style.height = 'auto';
  const need = Math.max(t.scrollHeight, t.offsetHeight);
  t.style.height = Math.max(44, Math.min(need, window.innerHeight * 0.34)) + 'px';
}
function wireDialogs() {
  $('#dlg-new').querySelector('#new-ok').onclick = async (e) => {
    e.preventDefault();
    const kind = $('#new-kind').value, name = $('#new-name').value.trim();
    if (name.length < 2) return toast('Название от 2 символов.');
    const id = await api.rpc('chat_room_add', { p_kind: kind, p_name: name, p_nick: me.nick, p_code_hash: me.hash }).catch(err => toast(err.message));
    if (!id) return;
    $('#dlg-new').close(); $('#new-name').value = '';
    await loadRooms();
    active = { kind: 'room', id: Array.isArray(id) ? id[0] : id, name };
    LS.set('active', active); shown = new Map(); paint(); startPoll(); renderRooms();
    toast(kind === 'group' ? 'Группа создана — кидать название в общий канал' : 'Канал создан');
  };
  $('#dlg-dm').querySelector('#dm-ok').onclick = (e) => {
    e.preventDefault();
    const peer = $('#dm-peer').value.trim();
    if (!peer) return;
    $('#dlg-dm').close(); active = { kind: 'dm', name: peer }; LS.set('active', active);
    shown = new Map(); toggleDrawer(false); renderRooms(); paint(); startPoll();
  };
}
async function online() {
  const rows = await api.rpc('chat_online', {}).catch(() => []);
  const list = Array.isArray(rows) ? rows : [];
  $('#online-line').textContent = `в чате сейчас: ${list.length ? list.map(r => r.nick).join(', ') : 'пока только ты'}`;
}
async function enter() {
  const v = await api.rpc('chat_auth', { p_nick: me.nick, p_code_hash: me.hash });
  const r = Array.isArray(v) ? v[0] : v;
  if (!r?.ok) {
    sessionStorage.removeItem('eschat.me');
    me.nick = me.hash = '';
    showLogin(r?.error === 'nick_taken' ? 'Такой ник уже занят и закреплён другим кодом.' : 'Код не подошёл. Войди по своему коду.');
    throw new Error('auth');
  }
  $('#login').hidden = true; $('#app').hidden = false;
  $('#demo-flag').hidden = !api.demo;
  if (matchMedia('(min-width: 860px)').matches) toggleDrawer(true);
  await loadRooms(); paint(); startPoll(); online(); setInterval(online, 30e3);
  api.onGone && api.onGone(() => pull());
  await api.rpc('chat_join', { p_room: active?.kind === 'room' ? active.id : null, p_nick: me.nick, p_code_hash: me.hash }).catch(() => {});
  if (!calls) {
    const { createCalls } = await import('./calls.js');
    calls = createCalls({
      api, me, toast,
      getPeer: () => active?.kind === 'dm' ? active.name : null,
      onButtons: (on) => {
        const a = document.getElementById('btn-call');
        const v = document.getElementById('btn-video');
        if (a) a.hidden = !on;
        if (v) v.hidden = !on;
      },
    });
  }
  calls.syncButtons();
}
async function showSetup() {
  document.body.classList.remove('busy');
  document.body.innerHTML = `<div class="sheet"><div class="sheet-card"><h1>Чат ещё не подключён</h1><p class="lead">Впиши в js/config.js URL и anon key Supabase.</p><button class="cta" id="btn-demo">Посмотреть демо</button></div></div>`;
  document.getElementById('btn-demo').onclick = () => { localStorage.setItem('eschat.demo', '1'); location.href = location.pathname + '?demo=1'; };
}
document.body.classList.add('busy');
async function boot() {
  try { api = await import(wantDemo() ? './demo.js' : './api.js'); }
  catch (e) {
    document.body.classList.remove('busy');
    document.body.innerHTML = `<div class="sheet"><div class="sheet-card"><h1>Страница догрузилась не вся</h1><button class="cta" onclick="location.reload()">Обновить</button></div></div>`;
    return;
  }
  if (!wantDemo() && !api.configured()) { showSetup(); return; }
  $('#btn-login').onclick = login;
  $('#in-code').addEventListener('keydown', e => e.key === 'Enter' && login());
  $('#in-nick').addEventListener('keydown', e => e.key === 'Enter' && $('#in-code').focus());
  $('#btn-gen').onclick = () => {
    const a = [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(36).padStart(2, '0')).join('');
    $('#in-code').value = a; $('#in-code').type = 'text';
  };
  $('#btn-rooms').onclick = () => toggleDrawer($('#drawer').hidden);
  $('#scrim').onclick = () => toggleDrawer(true);
  $('#btn-leave').onclick = () => { sessionStorage.removeItem('eschat.me'); location.reload(); };
  $('#lightbox').onclick = () => { $('#lightbox').hidden = true; };
  $('#btn-jump').onclick = () => { const b = $('#msgs'); b.scrollTop = b.scrollHeight; $('#jump').hidden = true; };
  document.querySelectorAll('.drawer-tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.drawer-tabs button').forEach(x => x.classList.toggle('on', x === b));
    if (b.dataset.tab === 'dm') { $('#btn-newroom').textContent = '+ написать в личку'; loadRooms(); }
    else $('#btn-newroom').textContent = '+ создать канал / группу';
    renderRooms();
  });
  $('#btn-newroom').onclick = () => {
    const tab = $('.drawer-tabs .on').dataset.tab;
    if (tab === 'dm') { $('#dm-peer').value = ''; $('#dlg-dm').showModal(); }
    else { $('#new-name').value = ''; $('#dlg-new').showModal(); }
  };
  wireDialogs();
  $('#composer').onsubmit = (e) => { e.preventDefault(); send(); };
  const ta = $('#in-body');
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  ta.addEventListener('paste', async e => {
    const f = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (f) { e.preventDefault(); await attach(f.getAsFile()); }
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) await attach(f); });
  $('#in-file').onchange = async e => { const f = e.target.files[0]; if (f) await attach(f); e.target.value = ''; };
  document.getElementById('btn-call').onclick = () => calls?.startAudio();
  document.getElementById('btn-video').onclick = () => calls?.startVideo();
  const saved = JSON.parse(sessionStorage.getItem('eschat.me') || 'null');
  const dbg = window.ESCHAT?.nick && window.ESCHAT?.code ? { nick: window.ESCHAT.nick, code: window.ESCHAT.code } : null;
  const seed = saved || dbg;
  if (seed) { $('#in-nick').value = seed.nick; $('#in-code').value = seed.code; await login(); }
  else showLogin();
  document.body.classList.remove('busy');
}
boot();
