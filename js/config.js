// Сюда впиши данные проекта Supabase (Settings → API Keys).
// Нужен ТОЛЬКО URL и public anon key: они и так видны в коде страницы,
// поэтому service_role и пароль от базы сюда класть нельзя.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const q = new URLSearchParams(location.search);
const from = local ? q : new URLSearchParams();   // su/sk/n/c действуют только на локальном стенде

window.ESCHAT = {
  url: from.get('su') || '',      // например https://abcd1234.supabase.co
  key: from.get('sk') || '',      // public anon key eyJhbGciOi...
  nick: from.get('n') || '',      // авто-вход — только для отладки на localhost
  code: from.get('c') || '',
};
