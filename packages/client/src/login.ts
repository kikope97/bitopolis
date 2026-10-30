import './style.css';

const form = document.querySelector<HTMLFormElement>('#login')!;
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (r.ok) {
    const next = new URLSearchParams(location.search).get('next') ?? '/';
    location.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/');
  } else {
    const body = await r.json().catch(() => null);
    document.querySelector('#login-error')!.textContent = body?.error ?? 'No se pudo entrar';
  }
});
