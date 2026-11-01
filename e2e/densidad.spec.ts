import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { addDebt, type GameState, newBuilding, OUTSIDE, runSimulation, transfer, TREASURY, validateCommand, VPO, Zone } from '../packages/sim/src/index.ts';
import { chooseOffer, pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/** 2.5 (bloque F): densidad de la zona R y vivienda protegida, en el móvil (360 px). */
function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

/** Pueblo del constructor con el ayuntamiento de nivel 3 (densidad alta y VPO) y dinero. */
function town(): GameState {
  const s = runSimulation({ seed: 1, days: 300, profile: 'constructor' }).state;
  s.townhallLevel = 3;
  transfer(s, OUTSIDE, TREASURY, 40_000, 'subvencion');
  s.weather = { kind: 'sol', until: s.tick + 30 * 24 };
  return s;
}

/** Bloques `res` construidos en zona R, del más cercano al ayuntamiento. */
function blocks(s: GameState) {
  const th = s.buildings.find((b) => b.kind === 'townhall')!;
  return s.buildings
    .filter((b) => b.kind === 'res' && b.built && s.map.zones[b.y * s.map.w + b.x] === Zone.R)
    .sort((a, b) => Math.abs(a.x - th.x) + Math.abs(a.y - th.y) - (Math.abs(b.x - th.x) + Math.abs(b.y - th.y)) || a.id - b.id);
}

function spot(s: GameState): { x: number; y: number } {
  const th = s.buildings.find((b) => b.kind === 'townhall')!;
  for (let r = 1; r <= 10; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (validateCommand(s, { type: 'Build', kind: 'vpo', x: th.x + dx, y: th.y + dy }).ok) return { x: th.x + dx, y: th.y + dy };
      }
  throw new Error('sin sitio para la VPO');
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, s: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(s), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
}

async function inspect(page: Page, x: number, y: number) {
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);
  const p = await tile(page, x, y);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.sheet')).toBeVisible();
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test('2.5: densidad de la zona R desde la bandeja, con su capa y el bloque crecido (360 px)', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-densidad-${n}.png` });
  const s = town();
  const [target, grown] = blocks(s);
  expect(target && grown).toBeTruthy();
  // Un bloque que ya creció a densidad alta (para ver su dibujo y su ficha).
  s.map.density = new Array(s.map.w * s.map.h).fill(0);
  s.map.density[grown!.y * s.map.w + grown!.x] = 2;
  grown!.dense = 2;
  await page.setViewportSize({ width: 360, height: 780 });
  await openTown(page, request, s);

  // La bandeja: categoría «Vivienda» con la VPO y las tres densidades (gratis).
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray h3', { hasText: 'Vivienda' })).toBeVisible();
  await expect(page.locator('#tray [data-tool="vpo"] .tool-cost')).toContainText('€');
  await expect(page.locator('#tray [data-tool="densityHigh"] .tool-cost')).toContainText('gratis');
  await page.locator('#tray [data-tool="densityHigh"]').scrollIntoViewIfNeeded();
  await shot('1-bandeja-360');
  await noOverflow(page);

  // La herramienta: ayuda en la franja y la capa «Densidad» puesta sola.
  await pickTool(page, 'densityHigh');
  await expect(page.locator('#strip')).toContainText('Densidad alta');
  await expect(page.locator('#legend')).toBeVisible();
  await expect(page.locator('#legend')).toContainText('Bloque crecido');

  // Se traza como las zonas (de una casilla a la de al lado).
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [target!.x, target!.y]);
  const a = await tile(page, target!.x, target!.y);
  const b = await tile(page, target!.x + 1, target!.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) {
    await expect(yes).toHaveText('Marcar densidad');
    await page.waitForTimeout(400);
    await yes.click();
  }
  await expect.poll(async () => (await state(page)).map.density?.[target!.y * s.map.w + target!.x]).toBe(2);
  await shot('2-capa-360');

  // Ficha del bloque crecido: 12 viviendas y el ruido.
  await pickTool(page, 'inspect');
  await inspect(page, grown!.x, grown!.y);
  const box = page.locator('.sheet [data-vivienda="densidad"]');
  await expect(box).toContainText('12 viviendas');
  await expect(box).toContainText('ruido');
  await box.scrollIntoViewIfNeeded();
  await shot('3-bloque-360');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('2.5: la vivienda protegida se construye desde la bandeja y su ficha dice quién vive y lo que paga (360 px)', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-densidad-${n}.png` });
  const s = town();
  // Una VPO ya hecha con cuatro inquilinos (uno debe el alquiler).
  const done = spot(s);
  const v = newBuilding(s, 'vpo', done.x, done.y, TREASURY);
  v.built = true;
  const tenants = s.citizens.filter((c) => !c.owns).slice(0, 4);
  for (const c of tenants) c.homeId = v.id;
  addDebt(s, tenants[0]!, 'town', VPO.rent);
  const at = spot(s);
  await page.setViewportSize({ width: 360, height: 780 });
  await openTown(page, request, s);

  // Se construye otra (con la barra «Construir» en el móvil).
  await pickTool(page, 'vpo');
  await expect(page.locator('#strip')).toContainText('Se sortean cada mes');
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [at.x, at.y]);
  const p = await tile(page, at.x, at.y);
  await page.mouse.click(p.x, p.y);
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) {
    await page.waitForTimeout(400);
    await yes.click();
  }
  await chooseOffer(page);
  await expect.poll(async () => (await state(page)).buildings.filter((b: { kind: string }) => b.kind === 'vpo').length, { timeout: 10_000 }).toBe(2);

  // La ficha de la que ya funciona: pisos, alquiler, a quién afecta, quién vive y quién debe.
  await pickTool(page, 'inspect');
  await inspect(page, done.x, done.y);
  const box = page.locator('.sheet [data-vivienda="vpo"]');
  await expect(box).toContainText('4 de 6 ocupados');
  await expect(box).toContainText(`${VPO.rent} €`);
  await expect(box).toContainText('A quién afecta');
  await expect(box).toContainText('Sorteo');
  await expect(box).toContainText('Viven aquí');
  await expect(box).toContainText('Deben el alquiler');
  await expect(box.locator('h3', { hasText: 'Viven aquí' })).toHaveCount(1);
  await expect(page.locator('.sheet h3', { hasText: 'Viven aquí' })).toHaveCount(1);
  await box.scrollIntoViewIfNeeded();
  await shot('4-vpo-360');
  await noOverflow(page);
  expect(errors).toEqual([]);
});
