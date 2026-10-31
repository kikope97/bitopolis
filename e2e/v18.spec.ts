import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, OUTSIDE, runSimulation, transfer, TREASURY } from '../packages/sim/src/index.ts';
import { skipTutorial, tile } from './helpers.ts';

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
