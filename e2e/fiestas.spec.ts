import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, OUTSIDE, runSimulation, transfer, TREASURY } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial, state } from './helpers.ts';

/** 2.4 (bloque E): fiestas de temporada en «Ayuntamiento»: aviso de la comisión, chips, programa y presupuesto. */
function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, s: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(s), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

async function expectTappable(page: Page, selector: string) {
  const boxes = await page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
}

test('2.4: la comisión de San Juan pide presupuesto y el alcalde paga la mitad (360 px)', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-fiestas-${n}.png` });

  // 22 de mayo del año 1: al día siguiente se forma la comisión de San Juan (Modo normal: por reglas).
  const s = runSimulation({ seed: 2, days: 141, profile: 'constructor' }).state;
  expect(s.citizens.filter((c) => c.named).length).toBeGreaterThanOrEqual(3);
  transfer(s, OUTSIDE, TREASURY, 20_000, 'subvencion');
  s.weather = { kind: 'sol', until: s.tick + 30 * 24 };
  await page.setViewportSize({ width: 360, height: 780 });
  await openTown(page, request, s);

  // El aviso de la comisión (fijo) lleva a su sección del Ayuntamiento.
  await setSpeed(page, 3);
  const toastEl = page.locator('.toast', { hasText: 'comisión de festejos' }).first();
  await expect(toastEl).toBeVisible({ timeout: 30_000 });
  await setSpeed(page, 0);
  const f = (await state(page)).seasons.current;
  expect(f.season).toBe('sanjuan');
  expect(f.committee).toHaveLength(3);
  expect(f.program).toContain('hoguera');
  await toastEl.click();
  await expect(page.locator('#th-seasons')).toBeVisible();

  // Cuatro chips de temporada (44 px), con San Juan elegido.
  await expectTappable(page, '.sheet [data-season]');
  await expect(page.locator('.sheet [data-season]')).toHaveCount(4);
  await expect(page.locator('.sheet [data-season="sanjuan"]')).toHaveAttribute('aria-checked', 'true');
  const box = page.locator('[data-test="season-box"]');
  await expect(box).toContainText('Comisión:');
  await expect(box).toContainText('Hoguera');
  await expectTappable(page, '.sheet [data-budget]');
  await expectTappable(page, '.season-committee [data-citizen]');
  await box.scrollIntoViewIfNeeded();
  await shot('1-comision-360');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // La mitad: la comisión recaudará el resto.
  await page.locator('.sheet [data-budget="poco"]').click();
  await expect.poll(async () => (await state(page)).seasons.current.status).toBe('aprobada');
  expect((await state(page)).seasons.current.budget).toBe('poco');
  await expect(page.locator('[data-test="season-box"]')).toContainText('la mitad');

  // Otra temporada: Navidad, con su fecha.
  await page.locator('.sheet [data-season="navidad"]').click();
  await expect(page.locator('.sheet [data-season="navidad"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-test="season-box"]')).toContainText('24 de diciembre');
  await shot('2-navidad-360');
  expect(errors).toEqual([]);
});
