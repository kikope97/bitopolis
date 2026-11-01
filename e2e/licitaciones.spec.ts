import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { applyCommand, type GameState, newBuilding, OUTSIDE, runSimulation, step, TENDER, transfer, TREASURY, validateCommand } from '../packages/sim/src/index.ts';
import { pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/** 2.2: licitaciones de obras y calles con nombre de vecinos. */
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

async function touch(page: Page, x: number, y: number) {
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);
  const p = await tile(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Si hay barra de confirmar (táctil), «Construir». */
async function confirmIfAsked(page: Page) {
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) {
    await page.waitForTimeout(400);
    await yes.click();
  }
}

/** Pueblo con ayuntamiento de nivel 3, dinero y una vecina con nombre que tiene tienda (hay primo). */
function makeTown() {
  const { state: s } = runSimulation({ seed: 3, days: 400, profile: 'casual', checkEveryDay: false });
  s.townhallLevel = Math.max(3, s.townhallLevel);
  transfer(s, OUTSIDE, TREASURY, 60_000, 'subvencion');
  for (const b of s.buildings) {
    delete b.fire;
    delete b.risk;
  }
  const spotFor = (kind: 'school' | 'water') => {
    for (let y = 2; y < s.map.h - 2; y++) for (let x = 2; x < s.map.w - 2; x++) if (validateCommand(s, { type: 'Build', kind, x, y }).ok) return { x, y };
    return null;
  };
  return { s, spotFor };
}

test('2.2: la obra grande se licita: hoja con tres ofertas y se elige la barata de fuera', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-licitaciones-${n}.png` });
  if (info.project.name === 'movil') await page.setViewportSize({ width: 360, height: 740 });
  const { s, spotFor } = makeTown();
  const spot = spotFor('school')!;
  expect(spot).toBeTruthy();
  await openTown(page, request, s);

  await pickTool(page, 'school');
  await touch(page, spot.x, spot.y);
  await confirmIfAsked(page);
  const cards = page.locator('.sheet.half .tender-card');
  await expect(cards).toHaveCount(3);
  await expect(page.locator('.sheet')).toContainText('Barata de fuera');
  await expect(page.locator('.sheet')).toContainText('Plazo');
  // Riesgo en palabras, nunca en %; tarjetas cómodas para el dedo a 360 px.
  expect(await page.locator('.tender-cards').innerText()).not.toContain('%');
  for (let i = 0; i < 3; i++) {
    const box = (await cards.nth(i).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(64);
    expect(box.x + box.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 1280) + 1);
  }
  await shot('1-ofertas');
  await page.locator('.tender-card[data-offer="fuera"]').click();
  await expect.poll(async () => (await state(page)).projects.find((p: { offer?: string }) => p.offer === 'fuera')?.offer, { timeout: 10_000 }).toBe('fuera');
  await expect(page.locator('.sheet')).toBeHidden();
  // La ficha de la obra lo cuenta.
  await pickTool(page, 'inspect');
  await touch(page, spot.x, spot.y);
  await expect(page.locator('.sheet [data-tender="fuera"]')).toContainText('empresa de fuera');
  await shot('2-obra-de-fuera');
  expect(errors).toEqual([]);
});

test('2.2: el rumor de la obra del primo y «Revisar el contrato»', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-licitaciones-${n}.png` });
  const { s, spotFor } = makeTown();
  // La concejala (la que más apoya al alcalde) tiene tienda.
  const named = s.citizens.filter((c) => c.named);
  for (const c of named) c.attitude = -2;
  const lucia = named[0]!;
  lucia.attitude = 2;
  const hall = s.buildings.find((b) => b.kind === 'townhall')!;
  let shopAt: { x: number; y: number } | null = null;
  for (let r = 2; r < 10 && !shopAt; r++) for (let dx = -r; dx <= r && !shopAt; dx++) {
    const x = hall.x + dx;
    const y = hall.y + r;
    if (!s.buildings.some((b) => b.x === x && b.y === y) && s.map.tiles[y * s.map.w + x] !== 1) shopAt = { x, y };
  }
  const shop = newBuilding(s, 'shop', shopAt!.x, shopAt!.y, lucia.id);
  shop.built = true;
  shop.name = 'Ferretería de Lucía';
  const spot = spotFor('water')!;
  expect(applyCommand(s, { type: 'Build', kind: 'water', ...spot, offer: 'primo' }).ok).toBe(true);
  const t = s.tenders!.at(-1)!;
  t.risk = true;
  for (let i = 0; i < TENDER.warnDays * 24; i++) step(s);
  expect(t.status).toBe('avisado');
  await openTown(page, request, s);

  await touch(page, spot.x, spot.y);
  const box = page.locator('.sheet [data-tender="rumor"]');
  await expect(box).toContainText('Se comenta en el bar');
  await shot('3-rumor');
  await page.locator('[data-review]').click();
  await expect.poll(async () => (await state(page)).tenders.find((x: { buildingId: number }) => x.buildingId === t.buildingId)?.status).toBe('revisado');
  await expect(page.locator('.sheet [data-tender="revisado"]')).toBeVisible();
});

test('2.2: en el pleno se dedica una calle a una vecina; el rótulo sale en el mapa y el derribo lo borra', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-calles-${n}.png` });
  const { s } = makeTown();
  s.departed.push({ id: s.nextId++, name: 'Rosario Martín', age: 91, tick: s.tick, reason: 'fallecio' });
  s.lastPlenoTick = -1;
  expect(applyCommand(s, { type: 'ConvenePleno' }).ok).toBe(true);
  expect(s.pleno?.street?.candidates.length).toBeGreaterThan(0);
  const hall = s.buildings.find((b) => b.kind === 'townhall')!;
  const road = { x: hall.x + 1, y: hall.y + 1 };
  await openTown(page, request, s);

  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Pleno municipal' }).click();
  const card = page.locator('.sheet .street-card');
  await expect(card).toContainText('Dedicar una calle');
  await expect(card).toContainText('Rosario Martín');
  await shot('1-pleno');
  await card.locator('.street-pick', { hasText: 'Rosario Martín' }).click();
  await expect(page.locator('.sheet')).toBeHidden();
  await expect(page.locator('#strip')).toContainText('Dedicar una calle');
  await touch(page, road.x, road.y);
  await expect(page.locator('#confirm-yes')).toHaveText('Dedicar aquí');
  await page.waitForTimeout(400);
  await shot('2-franja');
  await page.locator('#confirm-yes').click();
  await expect.poll(async () => (await state(page)).streetNames?.[0]?.name).toBe('Calle de Rosario Martín');
  await page.waitForTimeout(300);
  await shot('3-rotulo');
  expect((await state(page)).album.some((m: { kind: string }) => m.kind === 'calle')).toBe(true);

  // Derribar un trozo de la calle le quita el nombre (se toca la mitad de arriba: la de abajo es el tejado de lo de debajo).
  await pickTool(page, 'demolish');
  const a = await tile(page, road.x, road.y);
  const b = await tile(page, road.x, road.y + 1);
  await page.mouse.click(a.x, a.y - (b.y - a.y) * 0.3);
  await page.waitForTimeout(400);
  await page.locator('#confirm-yes').click();
  await expect.poll(async () => (await state(page)).streetNames?.length).toBe(0);
  expect(errors).toEqual([]);
});
