// Транспорт к Supabase: PostgREST + Storage. Без библиотек и сборки.
// Конфиг берётся из js/config.js (window.ESCHAT) — туда вписываешь URL проекта и anon-ключ.

const cfg = Object.assign({ url: '', key: '' }, window.ESCHAT || {});
const base = () => cfg.url.replace(/\/+$/, '');
const headers = (extra = {}) => ({
  apikey: cfg.key, Authorization: 'Bearer ' + cfg.key,
  'Content-Type': 'application/json', ...extra,
});
export const demo = false;                    // режим витрины включается в demo.js
export const configured = () => /^https?:\/\//i.test(base()) && cfg.key.length > 8;

async function req(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) {
    let d = '';
    try { d = (await r.json())?.message || ''; } catch { d = (await r.text()).slice(0, 200); }
    throw new Error(d || r.status + ' ' + r.statusText);
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

export const rpc = (fn, args) =>
  req(`${base()}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers({ 'Prefer': 'count=exact' }), body: JSON.stringify(args) });

// открытая лента комнаты: только чтение того, что разрешено политиками
export async function roomMessages(roomId, afterId, limit = 200) {
  const q = new URLSearchParams({
    select: 'id,author,body,media,created_at',
    room_id: 'eq.' + roomId,
    order: 'id.desc',
    limit: String(limit),
  });
  if (afterId) q.set('id', 'gt.' + afterId);
  const rows = await req(`${base()}/rest/v1/chat_message?${q}`, { headers: headers({ Accept: 'application/json' }) });
  return rows.reverse();
}

export async function rooms() {
  const q = new URLSearchParams({ select: 'id,kind,name,owner,topic,created_at', order: 'kind.asc,name.asc', limit: '300' });
  return req(`${base()}/rest/v1/chat_room?${q}`, { headers: headers({ Accept: 'application/json' }) });
}

const sha256js = (msg) => {                       // запасной вариант для http:// без WebCrypto
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bytes = new TextEncoder().encode(msg);
  const bit = bytes.length * 8;
  const pad = new Uint8Array((((bytes.length + 9) >> 6) + 1) << 6);
  pad.set(bytes); pad[bytes.length] = 0x80;
  new DataView(pad.buffer).setUint32(pad.length - 4, bit | 0, false);
  new DataView(pad.buffer).setUint32(pad.length - 8, Math.floor(bit / 2 ** 32), false);
  for (let i = 0; i < pad.length; i += 64) {
    const w = new Array(64);
    for (let t = 0; t < 16; t++) w[t] = new DataView(pad.buffer).getUint32(i + t * 4, false);
    for (; t < 64; t++) { const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3), s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10); w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0; }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), tmp1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), tmp2 = (S0 + mj) | 0;
      hh = g; g = f; f = e; e = (d + tmp1) | 0; d = c; c = b; b = a; a = (tmp1 + tmp2) | 0;
    }
    h = h.map((x, k) => [a, b, c, d, e, f, g, hh][k] + x + (h[k] - [a, b, c, d, e, f, g, hh][k]) | 0);
    h = [a | 0, b | 0, c | 0, d | 0, e | 0, f | 0, g | 0, hh | 0].map((x, k) => (x + [h[k]]) | 0);
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
};

export async function sha256(text) {
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256js(text);                                   // код-пароль не уходит с устройства и так
}
export const codeHash = (nick, code) => sha256(nick + '␟' + code);

export const mediaUrl = (m) => m;                 // вложения лежат в строке сообщения
export const maxChars = 400000;                   // потолок chat_*.media, совпадает с CHECK в БД
export const dataUrl = (blob) => new Promise((ok, no) => {
  const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob);
});

// автоочистка: одна метёлка на всех, чаще раза в минуту не срабатывает
export const sweep = () => rpc('chat_gc', {}).catch(() => null);
