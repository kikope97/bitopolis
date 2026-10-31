import './style.css';

const form = document.querySelector<HTMLFormElement>('#login')!;
if (new URLSearchParams(location.search).has('caducada')) {
  document.querySelector('#login-why')!.textContent = 'Tu sesión ha caducado o ha cambiado la contraseña. Vuelve a entrar: tu pueblo está guardado hasta el último día completo.';
}
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
