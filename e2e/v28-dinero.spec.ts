import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { applyCommand, type GameState, ibiForecast, loanCapacity, monthNet, runSimulation, step, taxLevels } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial, state as hookState } from './helpers.ts';

/**
 * 2.8 (ronda 24, parte B): el dinero dice lo mismo en todas partes. El parte
 * cuadra (la cabecera es «Entra» − «Sale cada mes», el préstamo va aparte), la
 * confirmación del préstamo dice cómo quedará la nota y la estimación del IBI es
 * la que se cobra. A 360 px en el móvil.
 */
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

const digits = (s: string | null) => Number((s ?? '').replace(/[^\d]/g, ''));

/** Un pueblo con un mes cerrado en el que el banco prestó dinero. */
function townWithLoanMonth(): { state: GameState; loan: number } {
  const { state } = runSimulation({ seed: 42, days: 300, profile: 'casual', checkEveryDay: false });
  const loan = loanCapacity(state, 48);
  expect(loan).toBeGreaterThanOrEqual(1_000);
  expect(applyCommand(state, { type: 'RequestLoan', amount: loan, months: 48 }).ok).toBe(true);
  const n = state.stats.length;
  while (state.stats.length === n) step(state);
  return { state, loan };
}

test('2.8: el parte cuadra: «Entra» sin el préstamo, el préstamo aparte y la cabecera = Entra − Sale cada mes', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (info.project.name === 'movil') await page.setViewportSize({ width: 360, height: 740 });
  const { state, loan } = townWithLoanMonth();
  const n = monthNet(state.stats.at(-1)!);
  expect(n.loansIn).toBe(loan);
  await openTown(page, request, state);

  await page.locator('#hud-money').click();
  await expect(page.locator('#sheet-title')).toContainText('Parte de');
  const sheet = page.locator('.sheet');
  await expect(sheet.locator('[data-test="report-loan"]')).toContainText('Préstamo recibido');
  expect(digits(await sheet.locator('[data-test="report-loan"]').textContent())).toBe(loan);
  const entra = sheet.locator('h3', { hasText: /^Entra:/ });
  const sale = sheet.locator('h3', { hasText: /^Sale cada mes:/ });
  expect(digits(await entra.textContent())).toBe(n.own);
  expect(digits(await sale.textContent())).toBe(n.running);
  // La cabecera es la resta de las dos líneas (y no cuenta lo que prestó el banco).
  const head = await sheet.locator('[data-test="report-net"]').textContent();
  expect(digits(head)).toBe(Math.abs(n.own - n.running));
  expect(head).toContain(n.net >= 0 ? '▲' : '▼');
  const overflow = await page.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v28-parte.png` });
  expect(errors).toEqual([]);
});

test('2.8: la confirmación del préstamo dice cómo quedará la nota; la estimación del IBI es lo que se cobra', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (info.project.name === 'movil') await page.setViewportSize({ width: 360, height: 740 });
  const { state } = runSimulation({ seed: 42, days: 300, profile: 'casual', checkEveryDay: false });
  await page.addInitScript(() => localStorage.setItem('bitopolis.prefs', JSON.stringify({ fullHub: true })));
  await openTown(page, request, state);

  await page.locator('#menu').click();
  await page.getByRole('button', { name: /^Préstamos · nota/ }).click();
  await expect(page.locator('#sheet-title')).toHaveText('Préstamos');
  await expect(page.locator('[data-test="loan-after"]')).toHaveText(/Tu nota (seguirá en [AB]|pasará de [AB] a [AB])/);
  await page.locator('#loan-ask').click();
  await expect(page.getByRole('alertdialog')).toContainText(/Tu nota (seguirá|pasará)/);
  await page.getByRole('alertdialog').getByRole('button', { name: 'No', exact: true }).click();
  await page.locator('.sheet-close').click();

  // Tributos: el IBI «≈ X €/mes» del nivel actual es `ibiForecast` (la cuenta del cobro).
  // Con un solo control (menos de 50 vecinos), «IBI ≈ X €/mes, tasas …».
  const st = await hookState(page);
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Impuestos' }).click();
  const lv = taxLevels(st).ibi;
  const group = page.getByRole('radiogroup', { name: st.taxesSplit ? 'IBI' : 'Nivel de impuestos' });
  const text = (await group.getByRole('radio', { checked: true }).textContent()) ?? '';
  const ibi = st.taxesSplit ? text.split('·')[1] : text.match(/IBI ≈ ([\d.]+) €/)?.[1];
  expect(digits(ibi ?? '')).toBe(ibiForecast(st, lv));
  expect(errors).toEqual([]);
});
