import { expect, test } from '@playwright/test';

test('PWA: manifest, iconos, service worker y vuelta a la última partida', async ({ page, request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m.name).toBe('Bitópolis');
  expect(m.icons.length).toBeGreaterThanOrEqual(2);
  for (const icon of m.icons) expect((await request.get(icon.src)).headers()['content-type']).toContain('image/png');
  await page.goto('/');
  await expect(page).toHaveURL(/\/p\/([0-9A-Za-z]{22})$/);
  const url = page.url();
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()))).toBe(true);
  // Abrir desde el icono instalado vuelve a la última partida de este dispositivo.
  await page.goto('/?pwa=1');
  await expect(page).toHaveURL(url);
});
