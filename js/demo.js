// Демо-режим без сервера: та же интерфейсная поверхность, что и api.js, но данные живут
// в localStorage этого браузера и расходятся по его вкладкам через BroadcastChannel.
// Настоящего обмена между людьми тут нет — это витрина интерфейса, о чём честно говорит баннер.
const DB = 'eschat.demo.v1';
const CH = new BroadcastChannel('eschat.demo');
const TTL = 48 * 3600 * 1000;

const load = () => {
  try { return JSON.parse(localStorage.getItem(DB)) || seed(); } catch { return seed(); }
};
const save = (d) => { localStorage.setItem(DB, JSON.stringify(d)); CH.postMessage({ t: 'went' }); };
function seed() {
  const now = Date.now();
  return {
    ids: { Иван: 'd1', Мария: 'd2' },
    rooms: [
      { id: 'r1', kind: 'channel', name: 'ЭС-общий', owner: 'Иван', topic: null, created_at: new Date(now - 9e6).toISOString() },
      { id: 'r2', kind: 'group', name: 'Молниезащита', owner: 'Мария', topic: null, created_at: new Date(now - 8e6).toISOString() },
    ],
    msgs: [
      { id: 1, room_id: 'r1', author: 'Иван', body: 'Демо-режим: сообщения видны только в этом браузере, между людьми их не передаёт.', media: null, created_at: new Date(now - 7e6).toISOString() },
      { id: 2, room_id: 'r1', author: 'Мария', body: 'Чтобы чат стал настоящим — впиши проект Supabase в js/config.js.', media: null, created_at: new Date(now - 6e6).toISOString() },
    ],
    dm: [],
    seen: {},
    seq: 3,
  };
}

const codeHash = async (nick, code) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nick + '␟' + code));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const configured = () => true;
export { codeHash };
export const demo = true;

export async function rpc(fn, a = {}) {
  const d = load();
  const alive = (ts) => Date.now() - new Date(ts).getTime() < TTL;
  if (fn === 'chat_auth') {
    const okKnown = !!d.ids[a.p_nick];
    if (okKnown && d.ids[a.p_nick] !== a.p_code_hash) return [{ ok: false, error: 'nick_taken' }];
    d.ids[a.p_nick] = a.p_code_hash; save(d);
    return [{ ok: true, first: !okKnown }];
  }
  if (fn === 'chat_online') return Object.keys(d.ids).map((nick) => ({ nick, seen: new Date().toISOString() }));
  if (fn === 'chat_gc') {
    const before = d.msgs.length + d.dm.length;
    d.msgs = d.msgs.filter((m) => alive(m.created_at));
    d.dm = d.dm.filter((m) => alive(m.created_at));
    save(d);
    return [{ messages: before - d.msgs.length - d.dm.length, dm: 0 }];
  }
  if (fn === 'chat_dm_peers') {
    const mine = d.dm.filter((m) => m.nick_a === a.p_nick || m.nick_b === a.p_nick && d.ids[a.p_nick] === a.p_code_hash);
    const by = {};
    for (const m of mine) { const p = m.nick_a === a.p_nick ? m.nick_b : m.nick_a; if (!by[p] || by[p].last_id < m.id) by[p] = { peer: p, last_id: m.id, last_at: m.created_at, recent_48h: 0 }; by[p].recent_48h++; }
    return Object.values(by).sort((x, y) => y.last_id - x.last_id);
  }
  if (fn === 'chat_dm_history') {
    if (d.ids[a.p_nick] !== a.p_code_hash) throw new Error('wrong code');
    const pair = [a.p_nick, a.p_peer].sort().join('|');
    return d.dm.filter((m) => m.pair === pair).sort((x, y) => y.id - x.id).slice(0, a.p_limit || 120);
  }
  if (fn === 'chat_room_add') {
    let r = d.rooms.find((x) => x.kind === a.p_kind && x.name === a.p_name);
    if (!r) { r = { id: 'r' + Date.now(), kind: a.p_kind, name: a.p_name, owner: a.p_nick, topic: null, created_at: new Date().toISOString() }; d.rooms.push(r); save(d); }
    return r.id;
  }
  if (fn === 'chat_send') {
    if (d.ids[a.p_nick] !== a.p_code_hash) throw new Error('wrong code');
    d.msgs.push({ id: d.seq++, room_id: a.p_room, author: a.p_nick, body: a.p_body || '', media: a.p_media || null, created_at: new Date().toISOString() });
    save(d); return null;
  }
  if (fn === 'chat_dm_send') {
    if (d.ids[a.p_nick] !== a.p_code_hash) throw new Error('wrong code');
    if (!d.ids[a.p_peer]) throw new Error('unknown peer');
    d.dm.push({ id: d.seq++, pair: [a.p_nick, a.p_peer].sort().join('|'), nick_a: a.p_nick, nick_b: a.p_peer, author: a.p_nick, body: a.p_body || '', media: a.p_media || null, created_at: new Date().toISOString() });
    save(d); return null;
  }
  if (fn === 'chat_join' || fn === 'chat_leave') return null;
  return [];
}

export async function rooms() { return load().rooms.map(({ id, kind, name, owner, topic, created_at }) => ({ id, kind, name, owner, topic, created_at })); }

export async function roomMessages(roomId) {
  const d = load(); const alive = (ts) => Date.now() - new Date(ts).getTime() < TTL;
  return d.msgs.filter((m) => m.room_id === roomId && alive(m.created_at)).sort((x, y) => x.id - y.id);
}

export const mediaUrl = (m) => m;
export const maxChars = 400000;
export const dataUrl = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
export const sweep = () => rpc('chat_gc', {});
export const onGone = (cb) => { CH.onmessage = cb; };
