import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type Building, type GameState, newBuilding, OUTSIDE, runSimulation, Terrain, Tile, transfer, TREASURY, validateCommand } from '../packages/sim/src/index.ts';
import { pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/** 2.1: bomberos e incendios, protección civil y dique. */
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

/** Centra el mapa en una casilla y la toca. */
async function touch(page: Page, x: number, y: number) {
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);
  const p = await tile(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Pueblo de partida: con ayuntamiento de nivel 3, dinero, una casa en riesgo, otra ardiendo sin bomberos y un sitio para el parque. */
function makeTown() {
  const { state: s } = runSimulation({ seed: 3, days: 400, profile: 'casual', checkEveryDay: false });
  s.townhallLevel = Math.max(3, s.townhallLevel);
  transfer(s, OUTSIDE, TREASURY, 60_000, 'subvencion');
  for (const b of s.buildings) {
    delete b.fire;
    delete b.risk;
    delete b.damaged;
  }
  for (const f of s.buildings.filter((b) => b.kind === 'firestation')) s.buildings = s.buildings.filter((x) => x !== f);
  const homes = s.buildings.filter((b) => (b.kind === 'res' || b.kind === 'house') && b.built);
  const atRisk = homes[0]!;
  const burning = homes.at(-1)!;
  atRisk.risk = { since: s.tick, why: 'las estufas del invierno' };
  burning.fire = { since: s.tick, until: s.tick + 200, covered: false };
  // Un solar libre junto a carretera para el parque de bomberos (lejos de la casa que arde).
  let spot: { x: number; y: number } | null = null;
  for (let y = 2; y < s.map.h - 2 && !spot; y++) {
    for (let x = 2; x < s.map.w - 2 && !spot; x++) {
      if (Math.abs(x - burning.x) + Math.abs(y - burning.y) < 14) continue;
      if (validateCommand(s, { type: 'Build', kind: 'firestation', x, y }).ok) spot = { x, y };
    }
  }
  return { s, atRisk, burning, spot: spot! };
}

test('2.1: casa en riesgo y ardiendo en su ficha; el parque de bomberos se construye desde «Emergencias»', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-incendios-${n}.png` });
  const { s, atRisk, burning, spot } = makeTown();
  expect(spot).toBeTruthy();
  await openTown(page, request, s);

  // La ficha avisa del riesgo y del fuego.
  await touch(page, atRisk.x, atRisk.y);
  await expect(page.locator('.sheet [data-fire="riesgo"]')).toContainText('En riesgo de incendio');
  await expect(page.locator('.sheet [data-fire="riesgo"]')).toContainText('No hay bomberos cerca');
  await shot('1-riesgo');
  await page.locator('.sheet-close').click();
  await touch(page, burning.x, burning.y);
  await expect(page.locator('.sheet [data-fire="ardiendo"]')).toContainText('¡Ardiendo!');
  await page.locator('.sheet-close').click();
  await shot('2-ardiendo');

  // Bandeja: categoría «Emergencias» con bomberos, protección civil y dique (este, bloqueado sin caseta).
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray')).toContainText('Emergencias');
  await expect(page.locator('#tray [data-tool="firestation"]')).toBeVisible();
  await expect(page.locator('#tray [data-tool="civilprotection"]')).toBeVisible();
  await expect(page.locator('#tray [data-tool="dike"] .tool-cost')).toContainText('protección civil');
  await shot('3-bandeja');
  await page.locator('#tab-build').click();

  // Construir el parque de bomberos.
  await pickTool(page, 'firestation');
  await touch(page, spot.x, spot.y);
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) await yes.click();
  await expect.poll(async () => (await state(page)).buildings.some((b: Building) => b.kind === 'firestation' && b.x === spot.x && b.y === spot.y), { timeout: 10_000 }).toBe(true);
  await shot('4-obra-bomberos');
  expect(errors).toEqual([]);
});

test('2.1: con bomberos cerca, el fuego se apaga en pocas horas (camión, aviso y sin daños); dique en la orilla', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-incendios-${n}.png` });
  const { s, burning, spot } = makeTown();
  // Parque de bomberos ya hecho y el fuego de la casa, al alcance.
  const st = newBuilding(s, 'firestation', spot.x, spot.y, TREASURY);
  st.built = true;
  const near = s.buildings.find((b) => (b.kind === 'res' || b.kind === 'house') && b.built && b !== burning && Math.abs(b.x - st.x) + Math.abs(b.y - st.y) <= 9);
  delete burning.fire;
  const target = near ?? burning;
  target.fire = { since: s.tick, until: s.tick + 3, covered: !!near };
  // Caseta de protección civil y un río junto a un solar libre (para el dique).
  let bank: { x: number; y: number } | null = null;
  for (let y = 3; y < s.map.h - 3 && !bank; y++) {
    for (let x = 3; x < s.map.w - 3 && !bank; x++) {
      const free = (a: number, b: number) => s.map.tiles[b * s.map.w + a] === Tile.Grass && !s.buildings.some((q) => q.x === a && q.y === b);
      if (free(x, y) && free(x, y - 1) && s.map.terrain[y * s.map.w + x] !== Terrain.River) {
        s.map.terrain[(y - 1) * s.map.w + x] = Terrain.River;
        bank = { x, y };
      }
    }
  }
  // La caseta, en una esquina del mapa (solo hace falta que exista para los diques).
  newBuilding(s, 'civilprotection', 0, 0, TREASURY).built = true;
  await openTown(page, request, s);

  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [target.x, target.y]);
  await shot('5-camion');
  await setSpeed(page, 1);
  await expect.poll(async () => (await state(page)).buildings.find((b: Building) => b.id === target.id)?.fire ?? null, { timeout: 30_000 }).toBeNull();
  await setSpeed(page, 0);
  const after = (await state(page)).buildings.find((b: Building) => b.id === target.id);
  if (near) {
    expect(after.damaged).toBeUndefined();
    await expect(page.locator('body')).toContainText('Los bomberos apagan');
  }

  // Dique en la orilla.
  await pickTool(page, 'dike');
  await touch(page, bank!.x, bank!.y);
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) await yes.click();
  await expect.poll(async () => ((await state(page)).dikes ?? []).length, { timeout: 10_000 }).toBe(1);
  await shot('6-dique');
  expect(errors).toEqual([]);
});
