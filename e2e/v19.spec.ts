import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { addDebt, type GameState, OUTSIDE, runSimulation, transfer, TREASURY } from '../packages/sim/src/index.ts';
import { skipTutorial } from './helpers.ts';

/** v1.9: economía de cada vecino (bolsillo, deudas, aplazar, microcrédito, sueldo mínimo, capa Bolsillo). */
function pack(state: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, state: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(state), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

test('v1.9: ficha con el bolsillo del vecino; aplazar su deuda; sueldo mínimo; capa Bolsillo', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v19-${n}.png` });
  const { state } = runSimulation({ seed: 3, days: 500, profile: 'constructor', checkEveryDay: false });
  state.townhallLevel = 3;
  transfer(state, OUTSIDE, TREASURY, 30_000, 'subvencion');
  const c = state.citizens.find((x) => x.named)!;
  transfer(state, c.id, OUTSIDE, c.money);
  addDebt(state, c, 'town', 640);
  addDebt(state, c, 'bank', 300);
  await openTown(page, request, state);

  // Vecinos › Con deudas › ficha con su bolsillo.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Vecinos' }).click();
  await page.getByRole('button', { name: /Con deudas/ }).click();
  await expect(page.locator('.sheet')).toContainText('deben dinero');
  await page.locator('.sheet .person-row').filter({ hasText: c.name }).first().click();
  await expect(page.locator('.sheet .pocket')).toContainText('Debe 940');
  await expect(page.locator('.sheet .pocket')).toContainText('endeudado');
  await shot('1-bolsillo');
  await page.getByRole('button', { name: /Aplazar/ }).click();
  await expect(page.locator('.sheet .pocket')).toContainText('Aplazado');
  await page.locator('.sheet-close').click();

  // Sueldo mínimo en los tributos.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Impuestos' }).click();
  await expect(page.locator('.sheet')).toContainText('Sueldo mínimo');
  await page.getByRole('radio', { name: /Alto.*1250/ }).click();
  await expect(page.getByRole('radio', { name: /Alto/ }).last()).toHaveAttribute('aria-checked', 'true');
  await shot('2-sueldo-minimo');
  await page.locator('.sheet-close').click();

  // Capa «Bolsillo de los vecinos».
  await page.locator('#layers').click();
  await page.getByRole('radio', { name: 'Bolsillo de los vecinos' }).click();
  await expect(page.locator('#legend')).toContainText('Endeudados');
  await shot('3-capa-bolsillo');
  expect(errors).toEqual([]);
});
