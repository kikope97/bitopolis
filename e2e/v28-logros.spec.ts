import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { createInitialState, type GameState, OUTSIDE, runSimulation, transfer, TREASURY } from '../packages/sim/src/index.ts';
import { confirmIfAsked, setSpeed, skipTutorial, tile } from './helpers.ts';

/** 2.8 (parte D): celebrar los logros: subida de nivel, barra de meta del escenario y resultado. */
function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, s: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(s), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  return token as string;
}

async function minSize(page: Page, sel: string) {
  // Sin la transformación de la animación de entrada (offsetWidth/offsetHeight).
  for (const box of await page.locator(sel).evaluateAll((els) => els.map((e) => ({ width: (e as HTMLElement).offsetWidth, height: (e as HTMLElement).offsetHeight })))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
}

test('al ampliar el ayuntamiento sale la tarjeta con lo que desbloquea y «Construir ahora» abre la bandeja', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { state: town } = runSimulation({ seed: 3, days: 500, profile: 'constructor', checkEveryDay: false });
  town.townhallLevel = 1;
  transfer(town, OUTSIDE, TREASURY, 30_000, 'subvencion');
  const hall = town.buildings.find((b) => b.kind === 'townhall')!;
  await openTown(page, request, town);
  await setSpeed(page, 0);
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [hall.x, hall.y]);
  const p = await tile(page, hall.x, hall.y);
  await page.mouse.click(p.x, p.y);
  await page.getByRole('button', { name: /Ampliar a nivel 2/ }).click();
  await confirmIfAsked(page);
  await expect(page.locator('.sheet')).toContainText('Nivel 2 de 5');
  // Con la hoja abierta no sale (no tapa «Gestión del pueblo»): espera a que se cierre.
  await expect(page.locator('[data-test="celebrate-level"]')).toHaveCount(0);
  await page.locator('.sheet-close').click();
  const card = page.locator('[data-test="celebrate-level"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('¡Ayuntamiento nivel 2!');
  await expect(card).toContainText('zonas R, C e I');
  await minSize(page, '.celebrate .btn');
  // El aviso del mismo suceso no se queda encima de la tarjeta (sigue en la campana).
  await expect(page.locator('#toasts .toast', { hasText: 'El ayuntamiento sube a nivel' })).toHaveCount(0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v28-nivel.png` });
  await card.getByRole('button', { name: 'Construir ahora' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('#tray')).toBeVisible();
  expect(errors).toEqual([]);
});

test('en un escenario, la barra de meta de la franja lleva a Objetivos', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const s = createInitialState({ seed: 4, scenario: 'quiebra' });
  await openTown(page, request, s);
  await setSpeed(page, 0);
  const bar = page.locator('#goal-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveText('Quiebra · 0/13 meses · quedan 24');
  await minSize(page, '#goal-bar');
  // Una línea (dos como mucho con el texto al 200 %, sin perder «quedan 24»), y nada se sale de la pantalla.
  await page.evaluate(() => (document.documentElement.dataset.text = '200'));
  const box = (await bar.boundingBox())!;
  expect(box.height).toBeLessThan(80);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v28-barra-meta.png` });
  await page.evaluate(() => (document.documentElement.dataset.text = '100'));
  await bar.click();
  await expect(page.locator('.sheet .scenario-goal')).toContainText('Pueblo en quiebra');
});

test('al cumplir la meta: tarjeta de resultado, «Cumplida en N meses» en Objetivos y «Reintentar» abre el mismo escenario', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  // Un día antes de cerrar el mes 24 con la meta ya cumplida: se marca como pendiente para que se cumpla al cerrar el mes.
  const { state: s } = runSimulation({ seed: 1, days: 30 * 24 - 1, profile: 'casual', scenario: 'vaciado', checkEveryDay: false });
  expect(s.citizens.length).toBeGreaterThanOrEqual(58);
  s.scenario.done = false;
  delete s.scenario.won;
  delete s.scenario.endedTick;
  for (const b of s.buildings) {
    delete b.fire;
    delete b.risk;
  }
  await openTown(page, request, s);
  await expect(page.locator('#goal-bar')).toBeVisible();
  await setSpeed(page, 3);
  const card = page.locator('[data-test="celebrate-end"]');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toHaveAttribute('data-won', 'true');
  await expect(card).toContainText('¡Meta cumplida!');
  await expect(card).toContainText('Cumplida en 24 meses');
  await expect(page.locator('#goal-bar')).toBeHidden();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v28-resultado.png` });
  await card.getByRole('button', { name: 'Cerrar' }).click();
  await expect(card).toHaveCount(0);
  await setSpeed(page, 0);
  // En Objetivos queda el resultado, con «Reintentar».
  await page.locator('#menu').click();
  const res = page.locator('[data-test="scenario-result"]');
  await expect(res).toContainText('Cumplida en 24 meses');
  await res.getByRole('button', { name: 'Reintentar este escenario' }).click();
  await page.locator('.modal-backdrop').getByRole('button', { name: 'Empezar' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9A-Za-z]{22}$/);
  await expect(page.locator('details.scenario-picker summary')).toContainText('El pueblo que se vacía');
});
