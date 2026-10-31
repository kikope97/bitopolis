import { expect, test } from '@playwright/test';
import { drag, state, tap, setSpeed } from './helpers.ts';

test('/healthz responde', async ({ request }) => {
  const r = await request.get('/healthz');
  expect(r.ok()).toBe(true);
  expect(await r.json()).toMatchObject({ ok: true });
});

test('partida nueva: tutorial, obras, guardado y continuar', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-${n}.png` });

  await page.goto('/');
  await expect(page).toHaveURL(/\/p\/[0-9A-Za-z]{22}$/);
  await expect(page.getByRole('button', { name: 'Jugar' })).toBeVisible();
  await shot('1-inicio');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('.tut-box')).toContainText('Carretera');
  await expect(page.locator('#hud-pop')).toHaveText('1 vecino');
  await shot('2-tutorial');

  const s0 = await state(page);
  const cx = Math.floor(s0.map.w / 2);
  const cy = Math.floor(s0.map.h / 2);

  await page.locator('[data-tool="road"]').click();
  await drag(page, [cx + 3, cy], [cx + 3, cy + 3]);
  await expect(page.locator('.tut-box')).toContainText('agua');
  await page.locator('[data-tool="water"]').click();
  await tap(page, cx - 2, cy + 1);
  await page.locator('[data-tool="power"]').click();
  await tap(page, cx + 2, cy + 1);
  await page.locator('[data-tool="house"]').click();
  await tap(page, cx + 4, cy + 2);
  await expect(page.locator('.tut-box')).toContainText('▶');
  const s1 = await state(page);
  expect(s1.projects.length).toBe(3);
  await shot('3-obras');

  await setSpeed(page, 10);
  await expect(page.locator('#hud-pop')).not.toHaveText('1 vecino', { timeout: 25_000 });
  await setSpeed(page, 0);
  await page.locator('[data-tool="inspect"]').click();
  await tap(page, cx + 4, cy + 2);
  await expect(page.locator('.sheet')).toContainText('Viven aquí');
  await shot('4-ficha');
  await page.locator('.sheet-close').click();

  await page.locator('#whatnow').click();
  await expect(page.locator('.toast').last()).toBeVisible();

  // Volver al inicio guarda y muestra las mini estadísticas.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Volver al inicio' }).click();
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.stats-card')).toContainText('vecinos');
  await shot('5-continuar');
  expect(errors).toEqual([]);
});

test('el mapa se mueve arrastrando y hace zoom con botones', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await page.locator('.tut-box button').click();
  const before = await page.evaluate(() => (window as any).__bitopolis.tileCenter(0, 0));
  const box = (await page.locator('#map').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 260, { steps: 5 });
  await page.mouse.up();
  const after = await page.evaluate(() => (window as any).__bitopolis.tileCenter(0, 0));
  expect(Math.abs(after.x - before.x - 60)).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Acercar' }).click();
  const zoomed = await page.evaluate(() => (window as any).__bitopolis.tileCenter(1, 0).x - (window as any).__bitopolis.tileCenter(0, 0).x);
  expect(zoomed).toBeGreaterThan(32);
});

test('otro dispositivo ve el aviso de partida abierta', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(page.url());
  await p2.getByRole('button', { name: 'Continuar' }).click();
  await expect(p2.getByRole('alertdialog')).toContainText('otro dispositivo');
  await other.close();
});
