// Сюда впиши данные проекта Supabase (Settings → API Keys).
// Понадобится ТОЛЬКО URL и public anon-ключ: их всё видно в коде страницы,
// поэтому access/rollback/secret ключи сюда вписывать нельзя.
const q = new URLSearchParams(location.search);
window.ESCHAT = {
  url: q.get('su') || '',      // например https://abcd1234.supabase.co  (или ?su=... для локального теста)
  key: q.get('sk') || '',      // public anon key  eyJhbGciOi...
  nick: q.get('n') || '',      // авто-вход: только для отладки
  code: q.get('c') || '',
};
