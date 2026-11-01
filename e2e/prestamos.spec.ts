import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { applyCommand, type GameState, loanCapacity, runSimulation } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial, state as hookState } from './helpers.ts';

/** 2.2: préstamos municipales (Dinero › Préstamos), a 360 px en el móvil. */
function pack(state: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, state: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(state), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
}

async function openLoans(page: Page) {
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /^Préstamos · nota/ }).click();
  await expect(page.locator('#sheet-title')).toHaveText('Préstamos');
}

/** Los botones del formulario se tocan bien con el dedo: 44 px como mínimo. */
async function expectTappable(page: Page, selector: string) {
  for (const box of await page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
}

test('2.2: pedir un préstamo (importe, plazo, cuota y TAE), verlo en la lista y amortizarlo', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (info.project.name === 'movil') await page.setViewportSize({ width: 360, height: 740 });
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-prestamos-${n}.png` });
  const { state } = runSimulation({ seed: 42, days: 300, profile: 'casual', checkEveryDay: false });
  expect(loanCapacity(state)).toBeGreaterThan(5_000);
  await openTown(page, request, state);

  await openLoans(page);
  await expect(page.locator('.loan-badge')).toHaveText(state.rating);
  await expect(page.locator('.sheet')).toContainText('No debes nada al banco');
  // 5.000 € por defecto; dos toques a «+» → 7.000 €; plazo 12 meses.
  await page.getByRole('button', { name: 'Mil euros más', exact: true }).click();
  await page.getByRole('button', { name: 'Mil euros más', exact: true }).click();
  await expect(page.locator('.loan-value')).toHaveText(/^7\.?000 €$/);
  await page.getByRole('radio', { name: '12 meses' }).click();
  await expect(page.getByRole('radio', { name: '12 meses' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.loan-offer')).toContainText(/Cuota: .* al mes · TAE \d/);
  await expectTappable(page, '.loan-step, .loan-chip, #loan-ask');
  // A 360 px no hay scroll horizontal en la hoja.
  const overflow = await page.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot('1-pedir');
  const before = (await hookState(page)).treasury;
  await page.locator('#loan-ask').click();
  await expect(page.getByRole('alertdialog')).toContainText('Devuelves');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Pedirlo' }).click();
  await expect(page.locator('.loan-item')).toHaveCount(1);
  await expect(page.locator('.loan-item')).toContainText(/Banco · 7\.?000 €/);
  await expect(page.locator('.loan-item')).toContainText('12 meses');
  const after = await hookState(page);
  expect(after.loans).toHaveLength(1);
  expect(after.treasury - before).toBe(7_000);
  await shot('2-lista');

  // Amortizar todo (con la comisión del 1 %).
  await page.getByRole('button', { name: 'Amortizar todo' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('comisión');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Amortizar' }).click();
  await expect(page.locator('.sheet')).toContainText('No debes nada al banco');
  expect((await hookState(page)).loans).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('2.2: con mucha carga, el 💰 se pone en ámbar y Préstamos lo avisa', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (info.project.name === 'movil') await page.setViewportSize({ width: 360, height: 740 });
  const { state } = runSimulation({ seed: 42, days: 300, profile: 'casual', checkEveryDay: false });
  // Ronda 18: lo máximo a 12 meses (el banco ya no deja pasar del 35 % de lo que entra), por encima del 25 %.
  expect(applyCommand(state, { type: 'RequestLoan', amount: loanCapacity(state, 12), months: 12 }).ok).toBe(true);
  await openTown(page, request, state);
  await expect(page.locator('#hud-money')).toHaveClass(/\bload\b/);
  await expect(page.locator('#hud-money')).toHaveAttribute('aria-label', /préstamos se llevan el \d+ %/);
  await page.locator('#menu').click();
  await expect(page.getByRole('button', { name: /^Préstamos · nota/ })).toHaveClass(/attn/);
  await page.getByRole('button', { name: /^Préstamos · nota/ }).click();
  await expect(page.locator('.loan-head')).toContainText(/carga (muy )?alta/);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-prestamos-3-carga.png` });
  expect(errors).toEqual([]);
});
