import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, OUTSIDE, runSimulation, Terrain, transfer, TREASURY } from '../packages/sim/src/index.ts';
import { pickTool, skipTutorial, tile } from './helpers.ts';

/** v1.7: geografía, tiempo, vida social, asociaciones, álbum, familia y «Qué falta». */
function pack(state: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

async function open(page: Page, request: import('@playwright/test').APIRequestContext, state: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(state), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

test('v1.7: qué falta, vida social, puente, asociaciones, álbum y árbol familiar', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v17-${n}.png` });
  const { state } = runSimulation({ seed: 2, days: 700, profile: 'constructor' });
  transfer(state, OUTSIDE, TREASURY, 30_000, 'subvencion');
  expect(state.map.terrain.includes(Terrain.River)).toBe(true);
  await open(page, request, state);

  // Capa «Qué falta» con su leyenda.
  await page.locator('#layers').click();
  await page.getByRole('radio', { name: 'Qué falta' }).click();
  await expect(page.locator('#legend')).toContainText('Qué falta');
  await shot('1-que-falta');
  await page.locator('#layers').click();
  await page.getByRole('radio', { name: 'Sin capa' }).click();

  // Vida social en la bandeja.
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray')).toContainText('Vida social');
  await page.locator('#tray [data-tool="bar"]').click();
  await expect(page.locator('#tool-info')).toContainText('Bar');
  await shot('2-bar');

  // Carretera sobre el río: es un puente (más caro).
  await pickTool(page, 'road');
  // Una casilla de río (sin puente) que se vea en pantalla.
  const box = (await page.locator('#map').boundingBox())!;
  let target: { x: number; y: number } | null = null;
  for (let i = 0; i < state.map.terrain.length && !target; i++) {
    if (state.map.terrain[i] !== Terrain.River || state.map.tiles[i] === 1) continue;
    const q = await tile(page, i % state.map.w, Math.floor(i / state.map.w));
    if (q.x > box.x + 30 && q.x < box.x + box.width - 80 && q.y > box.y + 60 && q.y < box.y + box.height - 30) target = q;
  }
  // En pantallas donde no se ve el río al entrar, esta parte no aplica (la cubre el test del motor).
  if (target) {
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(400);
    await page.mouse.click(target.x, target.y);
    await expect(page.locator('#strip')).toContainText(/600|puente/);
    await page.keyboard.press('Escape');
  }

  // Ayuntamiento: asociaciones vecinales.
  await pickTool(page, 'inspect');
  await page.locator('#menu').click();
  await page.locator('.hub-grid').getByRole('button', { name: 'Presupuesto y fiestas' }).click();
  await expect(page.locator('.sheet')).toContainText('Asociaciones vecinales');
  const meet = page.getByRole('button', { name: /Reunirse y prometer/ }).first();
  if (await meet.count()) {
    await meet.click();
    await expect(page.locator('.sheet')).toContainText('Les prometiste');
  }
  await shot('3-asociaciones');
  await page.locator('.sheet-back').click();

  // Álbum del pueblo.
  await page.getByRole('button', { name: 'Álbum del pueblo' }).click();
  await expect(page.locator('.album-card').first()).toBeVisible();
  await shot('4-album');
  await page.locator('.sheet-back').click();

  // Árbol familiar desde la ficha de un vecino.
  await page.getByRole('button', { name: 'Vecinos', exact: true }).click();
  await page.locator('.person-row').first().click();
  await page.getByRole('button', { name: /Árbol familiar/ }).click();
  await expect(page.locator('.sheet h2')).toContainText('Familia de');
  await shot('5-familia');
  expect(errors).toEqual([]);
});

test('v1.7: el tiempo se ve junto a la fecha (nieve)', async ({ page, request }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { state } = runSimulation({ seed: 7, days: 400, profile: 'constructor' });
  state.weather = { kind: 'nieve', until: state.tick + 5 * 24 };
  await open(page, request, state);
  await expect(page.locator('#hud-weather')).toHaveAttribute('aria-label', /nieve/);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v17-nieve.png` });
  expect(errors).toEqual([]);
});

test('v1.7.0: al volver a la partida sigue a la velocidad en que la dejaste', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await skipTutorial(page);
  await page.locator('#speed').click(); // x3 (y en marcha)
  await expect(page.locator('#play-pause')).toHaveAttribute('data-paused', 'false');
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#play-pause')).toHaveAttribute('data-paused', 'false');
  await expect(page.locator('#speed')).toHaveText('x3');
  // Y si lo dejas en pausa, vuelve en pausa.
  await page.locator('#play-pause').click();
  await page.reload();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#play-pause')).toHaveAttribute('data-paused', 'true');
});

test('v1.8: la versión de la aplicación sale abajo del todo en Ajustes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await skipTutorial(page);
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Ajustes/ }).click();
  await expect(page.locator('.sheet .app-version')).toHaveText(/^Bitópolis \d+\.\d+\.\d+$/);
});
