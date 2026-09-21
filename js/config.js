// Подключено к проекту Supabase es-chat (anon public — ок в клиенте).
// service_role и пароль БД сюда не класть.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const q = new URLSearchParams(location.search);
const from = local ? q : new URLSearchParams();

window.ESCHAT = {
  url: from.get('su') || "https://jfihexwwcwxsxjupcpcj.supabase.co",
  key: from.get('sk') || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmaWhleHd3Y3d4c3hqdXBjcGNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMDYxMDgsImV4cCI6MjEwNTU4MjEwOH0.ltFwyvuGm6KcprWzGluJYSKvo3gcHtfvNVW-yvLsr-0",
  nick: from.get('n') || '',
  code: from.get('c') || '',
};
