import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { createInitialState, cropAt, type GameState, isWater, runSimulation, Tile, Zone } from '../packages/sim/src/index.ts';
import { pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/** 2.2: el campo (zona agraria y fincas). */
function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, s: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(s), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

const center = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);

/** Dos casillas libres seguidas (en fila) junto al río, donde saldría regadío. */
function riverSpot(s: GameState): { x: number; y: number } | null {
  const { w, h } = s.map;
  const free = (x: number, y: number) => {
    const i = y * w + x;
    return x < w && s.map.tiles[i] !== Tile.Road && !isWater(s.map.terrain[i]) && s.map.zones[i] === Zone.None && !s.buildings.some((b) => b.x === x && b.y === y) && cropAt(s, x, y) === 'regadio';
  };
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 3; x++) if (free(x, y) && free(x + 1, y)) return { x, y };
  return null;
}

test('2.2: la zona agraria está en la bandeja (bloqueada hasta el nivel 2 y 20 vecinos)', async ({ page, request }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openTown(page, request, createInitialState({ seed: 21 }));
  await setSpeed(page, 0);
  await page.locator('#tab-build').click();
  const item = page.locator('#tray [data-tool="zoneA"]');
  await expect(item).toBeVisible();
  await expect(item).toContainText('Zona agraria');
  await expect(item).toContainText('nivel');
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-campo-1-bandeja.png` });
  // Bloqueada: al tocarla, la bandeja explica qué falta.
  await item.click({ force: true });
  await expect(page.locator('#tray .tray-msg')).toContainText('Zona agraria: llega con el ayuntamiento de nivel 2');
  expect(errors).toEqual([]);
});

test('2.2: al pintar zona agraria junto al río, la franja dice «Aquí: regadío (río)»; la ficha de la finca cuenta su cosecha', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-campo-${n}.png` });

  // Un pueblo con el perfil «campo» (ya tiene fincas) con río.
  let s: GameState | null = null;
  let spot: { x: number; y: number } | null = null;
  for (const seed of [11, 3, 5, 8, 13, 21]) {
    const r = runSimulation({ seed, days: 420, profile: 'campo' }).state;
    const sp = riverSpot(r);
    if (sp && r.buildings.some((b) => b.kind === 'farm' && b.built)) {
      s = r;
      spot = sp;
      break;
    }
  }
  expect(s && spot).toBeTruthy();
  s!.weather = { kind: 'sol', until: s!.tick + 30 * 24 };
  await openTown(page, request, s!);
  await setSpeed(page, 0);

  // La herramienta: precio y ayuda en la franja.
  await pickTool(page, 'zoneA');
  await expect(page.locator('#strip')).toContainText('Zona agraria');
  await expect(page.locator('#strip')).toContainText('ni agua ni luz');

  // Arrastrar junto al río: «Aquí: regadío (río)» mientras se arrastra.
  await center(page, spot!.x, spot!.y);
  const a = await tile(page, spot!.x, spot!.y);
  const b = await tile(page, spot!.x + 1, spot!.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await expect(page.locator('#strip')).toContainText('Aquí: regadío (río)');
  await shot('2-arrastrar-rio');
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).map.zones[spot!.y * s!.map.w + spot!.x]).toBe(Zone.A);

  // Ficha de una finca: cultivo, mes de cosecha y «cosecha prevista».
  const farm = (await state(page)).buildings.find((x: { kind: string; built: boolean }) => x.kind === 'farm' && x.built);
  await pickTool(page, 'inspect');
  await center(page, farm.x, farm.y);
  const p = await tile(page, farm.x, farm.y);
  await page.mouse.click(p.x, p.y);
  const sheet = page.locator('.sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Finca');
  await expect(sheet).toContainText('Cultivo:');
  await expect(sheet.locator('.farm-outlook')).toContainText(/Cosecha prevista: (buena|normal|mala)/);
  await expect(sheet).toContainText(/Cosecha: (este mes|en [a-z]+|ya cosechada)/);
  await shot('3-ficha-finca');
  expect(errors).toEqual([]);
});
