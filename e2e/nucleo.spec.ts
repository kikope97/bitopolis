import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import type { GameState } from '../packages/sim/src/index.ts';
import { chooseOffer, pickTool, setSpeed, skipTutorial, state, tap } from './helpers.ts';
import { NUCLEO, nucleoTown } from './nucleo-town.ts';

/** 2.6 «Lo básico» (bloque B): por qué no crece un solar, la carga de la bomba, la demanda, el coste al mes y «Deshacer». */
function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, s: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(s), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
}

const centerOn = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);

test('lo básico: motivo del solar, carga de la bomba, demanda, coste al mes y deshacer', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  // Móvil: 390 de ancho (iPhone), táctil.
  if (info.project.name === 'movil') await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-nucleo-${n}.png` });
  const { y, x0, lots, gap } = NUCLEO;
  await openTown(page, request, nucleoTown());
  await page.locator('.toast').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // 1. Ficha del solar: no crece por la luz (y qué hacer).
  await pickTool(page, 'inspect');
  await centerOn(page, lots[1]!, y + 1);
  await tap(page, lots[1]!, y + 1);
  const lot = page.locator('[data-test="lot-status"]');
  await expect(lot).toHaveAttribute('data-reason', 'luz');
  await expect(lot).toContainText('No crece: la calle de al lado no tiene luz');
  await expect(lot).toContainText('central eléctrica');
  await shot('1-solar');
  await page.locator('.sheet-close').click();

  // 2. Ficha de la bomba: lo que piden y quién se queda sin agua.
  await centerOn(page, x0 - 1, y);
  await tap(page, x0 - 1, y);
  const load = page.locator('[data-test="plant-load"]');
  await expect(load).toContainText('Da agua a 45 de 45 edificios');
  await expect(load).toContainText('Piden agua 49 de 45: 4 edificios se quedan sin agua');
  await load.scrollIntoViewIfNeeded();
  await shot('2-bomba');
  await page.locator('.sheet-close').click();

  // 3. Demanda: los solares que no crecen y de qué sale el número.
  await page.locator('#strip-info').click();
  await expect(page.locator('[data-test="lots-R"]')).toContainText('R +40, pero 4 solares no pueden crecer: sin luz');
  const factors = page.locator('[data-test="factors-R"]');
  await factors.locator('summary').click();
  await expect(factors).toContainText('Ganas de venir a vivir (base)');
  await expect(factors).toContainText('+40');
  await factors.scrollIntoViewIfNeeded();
  await shot('3-demanda');
  await page.locator('.sheet-close').click();

  // 4. Bandeja: lo que cuesta al mes (bomba: 150 € de mantenimiento y un sueldo de 900 €).
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray [data-tool="water"] .tool-month')).toHaveText('−1050 €/mes');
  await shot('4-bandeja');

  // 5. Poner una casa y deshacerla: se devuelven los materiales.
  await page.locator('#tray [data-tool="house"]').click();
  const before = (await state(page)).treasury as number;
  await centerOn(page, gap, y - 1);
  await tap(page, gap, y - 1);
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) {
    await page.waitForTimeout(400);
    await yes.click();
  }
  await chooseOffer(page, 'local');
  await expect(page.locator('#undo-bar')).toBeVisible();
  await expect(page.locator('#undo-text')).toContainText('Deshacer: recuperas 2000 €');
  await expect.poll(async () => (await state(page)).treasury).toBe(before - 2000);
  await shot('5-deshacer');
  await page.locator('#undo-btn').click();
  await expect.poll(async () => (await state(page)).treasury).toBe(before);
  const st = await state(page);
  expect(st.buildings.some((b: { x: number; y: number }) => b.x === gap && b.y === y - 1)).toBe(false);
  await expect(page.locator('#undo-bar')).toBeHidden();
  expect(errors).toEqual([]);
});

test('deshacer: con la obra ya empezada, «Deshacer» desaparece', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const { y, gap } = NUCLEO;
  await openTown(page, request, nucleoTown());
  await pickTool(page, 'house');
  await centerOn(page, gap, y - 1);
  await tap(page, gap, y - 1);
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) {
    await page.waitForTimeout(400);
    await yes.click();
  }
  await chooseOffer(page, 'local');
  await expect(page.locator('#undo-bar')).toBeVisible();
  // A x10 el día se cierra en 2 s: la obra empieza y ya no se puede deshacer con devolución.
  await setSpeed(page, 10);
  await expect(page.locator('#undo-bar')).toBeHidden({ timeout: 4000 });
  await setSpeed(page, 0);
  expect(info.project.name).toBeTruthy();
});
