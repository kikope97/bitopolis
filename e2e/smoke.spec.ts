import { expect, test } from '@playwright/test';

test('el pueblo carga y el tiempo avanza', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#hud-pop')).toContainText('vecino');
  await page.getByRole('button', { name: 'Velocidad x10' }).click();
  await expect(page.locator('#hud-date')).not.toHaveText('Año 1 · 1/1', { timeout: 10_000 });
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-inicio.png` });
  expect(errors).toEqual([]);
});

test('/healthz responde', async ({ request }) => {
  const r = await request.get('/healthz');
  expect(r.ok()).toBe(true);
  expect(await r.json()).toMatchObject({ ok: true });
});
