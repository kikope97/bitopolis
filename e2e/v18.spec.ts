import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, OUTSIDE, runSimulation, transfer, TREASURY } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial, tile } from './helpers.ts';

/** v1.8: ficha de casa completa, cárcel, tiendas destrozadas y su reparación. */
function pack(state: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, state: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(state), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

/** Abre la ficha de un edificio: centra el mapa en él y lo toca. */
async function inspect(page: Page, x: number, y: number) {
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);
  const p = await tile(page, x, y);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.sheet')).toBeVisible();
}

test('v1.8: ficha de casa con servicios y vecinos; cárcel en la bandeja; tienda destrozada que se repara', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v18-${n}.png` });
  const { state } = runSimulation({ seed: 3, days: 500, profile: 'constructor' });
  transfer(state, OUTSIDE, TREASURY, 30_000, 'subvencion');
  const shop = state.buildings.find((b) => b.kind === 'shop' && b.built)!;
  shop.damaged = { cost: 1_500, repairUntil: -1 };
  const house = state.buildings.find((b) => b.kind === 'house' && b.built)!;
  await openTown(page, request, state);

  // Ficha de casa: tabla de servicios y resumen de vecinos.
  await inspect(page, house.x, house.y);
  await expect(page.locator('.sheet .svc-table')).toContainText('Agua');
  await expect(page.locator('.sheet .svc-table')).toContainText('Seguridad');
  await expect(page.locator('.sheet')).toContainText('felicidad media');
  await shot('1-ficha-casa');
  await page.locator('.sheet-close').click();

  // La cárcel en la bandeja.
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray [data-tool="jail"]')).toBeVisible();
  await page.locator('#tab-build').click();

  // Tienda destrozada: aviso y «Reparar».
  await inspect(page, shop.x, shop.y);
  await expect(page.locator('.sheet')).toContainText('Destrozada');
  await shot('2-tienda-destrozada');
  await page.getByRole('button', { name: /Reparar/ }).click();
  await expect(page.locator('.sheet')).toContainText('En reparación');
  expect(errors).toEqual([]);
});

test('v1.8: el ayuntamiento abre el panel de gestión y se amplía; calendario a x3', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v18-${n}.png` });
  const { state } = runSimulation({ seed: 3, days: 500, profile: 'constructor' });
  state.townhallLevel = 1;
  transfer(state, OUTSIDE, TREASURY, 30_000, 'subvencion');
  const hall = state.buildings.find((b) => b.kind === 'townhall')!;
  await openTown(page, request, state);

  // Con el nivel 1, las zonas están bloqueadas y lo explican.
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray [data-tool="zoneR"] .tool-cost')).toContainText('nivel 2');
  await page.locator('#tab-build').click();

  await inspect(page, hall.x, hall.y);
  await expect(page.locator('.sheet h2')).toHaveText('Gestión del pueblo');
  await expect(page.locator('.sheet')).toContainText('Nivel 1 de 5');
  await expect(page.locator('.sheet')).toContainText('Lo que falta');
  await expect(page.locator('.sheet')).toContainText('Seguridad');
  await shot('3-gestion');
  await page.getByRole('button', { name: /Ampliar a nivel 2/ }).click();
  await expect(page.locator('.sheet')).toContainText('Nivel 2 de 5');
  await page.locator('.sheet-close').click();
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray [data-tool="zoneR"] .tool-cost')).not.toContainText('nivel');
  await page.locator('#tab-build').click();

  // Calendario: solo a x3/x10.
  await expect(page.locator('#calendar')).toBeHidden();
  await setSpeed(page, 3);
  await expect(page.locator('#calendar')).toBeVisible();
  await setSpeed(page, 1);
  await expect(page.locator('#calendar')).toBeHidden();
  expect(errors).toEqual([]);
});

test('v1.8: los servicios muestran su nivel y qué pide mejorarlos', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { state } = runSimulation({ seed: 3, days: 900, profile: 'constructor' });
  state.townhallLevel = 5;
  transfer(state, OUTSIDE, TREASURY, 100_000, 'subvencion');
  const pump = state.buildings.find((b) => b.kind === 'water' && b.built)!;
  // Una segunda bomba ya mejorada (se dibuja con su aspecto de nivel 3).
  pump.level = 3;
  await openTown(page, request, state);
  await inspect(page, pump.x, pump.y);
  await expect(page.locator('.sheet .level-box')).toContainText('Nivel 3 de 3');
  await expect(page.locator('.sheet .level-box')).toContainText('nivel más alto');
  await page.locator('.sheet-close').click();
  const police = state.buildings.find((b) => b.kind === 'police' && b.built)!;
  await inspect(page, police.x, police.y);
  await expect(page.locator('.sheet .level-box')).toContainText('Nivel 1 de 3');
  await expect(page.locator('.sheet .level-box .reqs li')).toHaveCount(4);
  await expect(page.locator('.sheet')).toContainText('Calabozos');
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v18-4-nivel-servicio.png` });
  expect(errors).toEqual([]);
});
