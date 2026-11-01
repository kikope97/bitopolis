import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { canUpgradeTownhall, type GameState, OUTSIDE, runSimulation, transfer, TREASURY } from '../packages/sim/src/index.ts';
import { drag, pickTool, setSpeed, skipTutorial, state, tap, tile } from './helpers.ts';

/**
 * 2.5.1: lo que se hace en pausa se guarda en el acto (antes esperaba al cierre del día, que en
 * pausa no llega) y lo pendiente sale con `keepalive` al recargar o cerrar la pestaña.
 */

const saved = (page: Page) => expect(page.locator('#saved')).toHaveText('Guardado', { timeout: 10_000 });
const tutStep = (page: Page) => page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('bitopolis.tut.'))?.[1] ?? null);

/** Partida nueva, un día jugado y en pausa. */
async function newGameOneDay(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await setSpeed(page, 10);
  await expect.poll(async () => (await state(page)).tick, { timeout: 15_000 }).toBeGreaterThanOrEqual(28);
  await setSpeed(page, 0);
  const s = await state(page);
  // Para que el reloj no esté justo en un cierre de día (el caso del jugador: 4 horas «perdidas»).
  expect(s.tick % 24).not.toBe(0);
  return s;
}

/** Carretera y bomba de agua en pausa, como en el tutorial. */
async function buildRoadAndWater(page: Page, s: GameState) {
  const cx = Math.floor(s.map.w / 2);
  const cy = Math.floor(s.map.h / 2);
  await pickTool(page, 'road');
  await drag(page, [cx + 3, cy], [cx + 3, cy + 3]);
  await expect.poll(async () => (await state(page)).map.tiles.filter((t: number) => t === 1).length).toBeGreaterThan(s.map.tiles.filter((t: number) => t === 1).length);
  await pickTool(page, 'water');
  await tap(page, cx - 2, cy + 1);
  await expect.poll(async () => (await state(page)).buildings.some((b: { kind: string }) => b.kind === 'water')).toBe(true);
  return state(page);
}

async function continueGame(page: Page) {
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await expect.poll(async () => (await state(page))?.tick ?? -1).toBeGreaterThanOrEqual(0);
  return state(page);
}

const same = (a: GameState, b: GameState) => {
  expect(b.tick).toBe(a.tick);
  expect(b.treasury).toBe(a.treasury);
  expect(b.buildings.map((x) => `${x.kind}@${x.x},${x.y}`)).toEqual(a.buildings.map((x) => `${x.kind}@${x.x},${x.y}`));
  expect(b.map.tiles).toEqual(a.map.tiles);
};

test('en pausa: carretera y agua siguen ahí al recargar; «Guardando…» hasta que el servidor lo tiene', async ({ page }, info) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (info.project.name === 'movil') await page.setViewportSize({ width: 390, height: 844 });
  const s0 = await newGameOneDay(page);
  await saved(page);
  const s1 = await buildRoadAndWater(page, s0);
  expect(s1.treasury).toBeLessThan(30_000);
  await saved(page);
  await expect(page.locator('#saved')).toHaveAttribute('data-pending', 'false');
  const step = await tutStep(page);

  await page.reload();
  const s2 = await continueGame(page);
  same(s1, s2);
  // El tutorial sigue en el mismo paso (la luz), ni adelantado ni atrasado.
  expect(await tutStep(page)).toBe(step);
  await expect(page.locator('.tut-box')).toContainText('luz');
  expect(errors).toEqual([]);
});

test('recargar o cerrar justo después de construir en pausa no pierde la obra', async ({ page, context }) => {
  test.setTimeout(60_000);
  const s0 = await newGameOneDay(page);
  await saved(page);
  // Recarga en el acto (sin esperar a «Guardado»): sale con keepalive al ocultarse la página.
  const s1 = await buildRoadAndWater(page, s0);
  await page.reload();
  const s2 = await continueGame(page);
  same(s1, s2);

  // Cerrar la pestaña nada más poner la luz y abrir otra (mismo dispositivo: misma sesión).
  const cx = Math.floor(s2.map.w / 2);
  const cy = Math.floor(s2.map.h / 2);
  await skipTutorial(page);
  await pickTool(page, 'power');
  await tap(page, cx + 2, cy + 1);
  await expect.poll(async () => (await state(page)).buildings.some((b: { kind: string }) => b.kind === 'power')).toBe(true);
  const s3 = await state(page);
  const url = page.url();
  await page.close();
  const p2 = await context.newPage();
  await p2.goto(url);
  // Sin el aviso de «otro dispositivo»: la pestaña cerrada soltó la partida.
  const s4 = await continueGame(p2);
  await expect(p2.getByRole('alertdialog')).toHaveCount(0);
  same(s3, s4);
});

test('ampliar el ayuntamiento en pausa sobrevive a la recarga', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { state: town } = runSimulation({ seed: 3, days: 500, profile: 'constructor' });
  town.townhallLevel = 1;
  transfer(town, OUTSIDE, TREASURY, 30_000, 'subvencion');
  expect(canUpgradeTownhall(town).ok).toBe(true);
  const hall = town.buildings.find((b) => b.kind === 'townhall')!;
  const file = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: town.formatVersion, exportedAt: '', mode: 'normal', state: town }));
  const { token } = await (await request.post('/api/import', { data: file, headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await continueGame(page);
  await skipTutorial(page);
  await setSpeed(page, 0);
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [hall.x, hall.y]);
  const p = await tile(page, hall.x, hall.y);
  await page.mouse.click(p.x, p.y);
  await page.getByRole('button', { name: /Ampliar a nivel 2/ }).click();
  await expect(page.locator('.sheet')).toContainText('Nivel 2 de 5');
  const s1 = await state(page);
  expect(s1.townhallLevel).toBe(2);
  await page.reload();
  const s2 = await continueGame(page);
  expect(s2.townhallLevel).toBe(2);
  expect(s2.tick).toBe(s1.tick);
  expect(s2.treasury).toBe(s1.treasury);
});

test('el tutorial no va por delante del pueblo: si falta el agua, vuelve a pedirla', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  const url = page.url();
  const token = url.split('/p/')[1]!;
  // Paso guardado: «Construye una casa» (como si el agua y la luz se hubieran hecho), pero no hay nada.
  await page.evaluate((t) => localStorage.setItem(`bitopolis.tut.${t}`, '4'), token);
  await page.reload();
  await continueGame(page);
  await expect(page.locator('.tut-box')).toContainText('agua');
  expect(await tutStep(page)).toBe('2');
});
