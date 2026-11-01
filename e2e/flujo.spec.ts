import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { createInitialState, type GameState, OUTSIDE, runSimulation, transfer, TREASURY } from '../packages/sim/src/index.ts';
import { drag, pickTool, setSpeed, skipTutorial, state, tap } from './helpers.ts';

/** Pruebas 2.5: flujo, textos y erratas que encontró un jugador de pruebas. */
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

test('tutorial: la confirmación de la carretera se explica según el puntero', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await pickTool(page, 'road');
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  await expect(page.locator('.tut-box')).toContainText(coarse ? 'Confirma con «Construir»' : 'Haz clic otra vez en el final para confirmar');
});

test('zona sin carretera: aviso al marcarla, en la ficha del solar y en la demanda; la demanda, legible', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-flujo-${n}.png` });
  const s = createInitialState({ seed: 4 });
  s.townhallLevel = 2;
  transfer(s, OUTSIDE, TREASURY, 20_000, 'subvencion');
  s.weather = { kind: 'sol', until: s.tick + 30 * 24 };
  s.demand.I = 100;
  s.demand.R = 12;
  s.demand.C = -5;
  const hall = s.buildings.find((b) => b.kind === 'townhall')!;
  await openTown(page, request, s);
  // Un rectángulo de zona I a 3 casillas por encima del ayuntamiento (lejos de la calle).
  const x0 = hall.x - 2;
  const y0 = hall.y - 6;
  const st = await state(page);
  for (let x = x0; x <= x0 + 2; x++) for (let y = y0; y <= y0 + 1; y++) expect(st.map.tiles[y * st.map.w + x]).not.toBe(1);
  await pickTool(page, 'zoneI');
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x0 + 1, y0 + 2]);
  await drag(page, [x0, y0], [x0 + 2, y0 + 1]);
  // Con el dedo hay que confirmar con «Marcar zona»; la barra ya avisa antes.
  const confirm = page.locator('#confirm-yes');
  if (await confirm.isVisible()) {
    await expect(page.locator('#confirm-text')).toContainText('sin carretera');
    await page.waitForTimeout(400);
    await confirm.click();
  }
  await expect(page.locator('#tool-info')).toContainText('6 casillas sin carretera: aquí no se construirá');
  await shot('1-zona-sin-carretera');
  await pickTool(page, 'inspect');
  await tap(page, x0 + 1, y0);
  await expect(page.locator('[data-test="lot-no-road"]')).toContainText('Falta carretera');
  await page.locator('.sheet-close').click();
  await page.locator('#strip-info').click();
  const items = page.locator('.demand-list li');
  await expect(items.nth(0)).toContainText('Falta poco sitio');
  await expect(items.nth(1)).toContainText('Hay tiendas de sobra');
  await expect(items.nth(2)).toContainText('Tienes zona I sin carretera');
  // Título y explicación en líneas distintas (no «R · viviendasHay…»).
  const title = await items.nth(0).locator('strong').boundingBox();
  const sub = await items.nth(0).locator('.p-sub').boundingBox();
  expect(sub!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
  await shot('2-demanda');
  expect(errors).toEqual([]);
});

test('bandeja plegada, ampliación con aviso, pleno sin rojo y títulos de la comarca', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-flujo-${n}.png` });
  const s = createInitialState({ seed: 6 });
  const base = s.citizens[0]!;
  while (s.citizens.length < 10) s.citizens.push({ ...structuredClone(base), id: s.nextId++, money: 0, homeId: null, jobId: null, named: false, flow: [0, 0] });
  // Caja justa: tras ampliar (3.000 €) quedan 100 €.
  transfer(s, TREASURY, OUTSIDE, s.treasury - 3_100, 'subvencion');
  s.weather = { kind: 'sol', until: s.tick + 30 * 24 };
  await openTown(page, request, s);

  await page.locator('#tab-build').click();
  await expect(page.locator('#tray details[data-cat="Lo básico"]')).toHaveAttribute('open', '');
  const big = page.locator('#tray details[data-cat="Grandes obras"]');
  await expect(big).not.toHaveAttribute('open', '');
  await expect(big.locator('summary')).toContainText(/Grandes obras \(\d+ · /);
  await big.locator('summary').click();
  await expect(big).toHaveAttribute('open', '');
  await shot('3-bandeja');
  await page.locator('#tab-build').click();

  const hall = s.buildings.find((b) => b.kind === 'townhall')!;
  await pickTool(page, 'inspect');
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [hall.x, hall.y]);
  await tap(page, hall.x, hall.y);
  await expect(page.locator('[data-test="upgrade-after"]')).toContainText('Te quedarán 100 €');
  await expect(page.locator('[data-test="upgrade-after"]')).toContainText('a fin de mes pagas ≈');
  await page.locator('.mg-upgrade').click();
  await expect(page.locator('[data-test="upgrade-done"]')).toContainText('Ayuntamiento ampliado a nivel 2');
  await expect(page.locator('[data-test="upgrade-done"]')).toBeVisible();
  await shot('4-ampliado');
  await page.locator('.sheet-close').click();

  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Pleno municipal' }).click();
  await page.getByRole('button', { name: /Convocar pleno/ }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg.getByRole('button', { name: 'Convocar' })).toHaveClass(/primary/);
  await expect(dlg.getByRole('button', { name: 'No' })).not.toHaveClass(/primary|danger/);
  await dlg.getByRole('button', { name: 'No' }).click();
  await page.locator('.sheet-close').click();

  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Comarca y grandes obras/ }).click();
  await expect(page.locator('.sheet h2')).toContainText('Comarca y grandes obras');
});

test('al bajar a x1 por un incendio se dice y se puede volver a la velocidad de antes', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-flujo-${n}.png` });
  const { state: s } = runSimulation({ seed: 3, days: 300, profile: 'casual', checkEveryDay: false });
  transfer(s, OUTSIDE, TREASURY, 20_000, 'subvencion');
  s.weather = { kind: 'sol', until: s.tick + 60 * 24 };
  for (const b of s.buildings) {
    delete b.fire;
    delete b.risk;
  }
  s.buildings = s.buildings.filter((b) => b.kind !== 'firestation');
  // Muchas casas con el riesgo ya cumplido: al cerrar el día, alguna arde (cada una, a cara o cruz).
  for (const b of s.buildings.filter((x) => (x.kind === 'res' || x.kind === 'house') && x.built)) b.risk = { since: s.tick - 100, why: 'las estufas del invierno' };
  await openTown(page, request, s);
  await setSpeed(page, 3);
  await expect(page.locator('#slow-note')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#slow-note')).toContainText('Bajo a x1 por el incendio');
  await expect(page.locator('#speed')).toHaveText('x1');
  await shot('5-bajo-a-x1');
  await page.locator('#slow-back').click();
  await expect(page.locator('#speed')).toHaveText('x3');
  await expect(page.locator('#slow-note')).toBeHidden();
});
