import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, newBuilding, OUTSIDE, runSimulation, Terrain, transfer, TREASURY, validateCommand } from '../packages/sim/src/index.ts';
import { chooseOffer, pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/** 2.4 «Vida» en el móvil (360 px): bandeja, estación con su billete, residencia con su cuota y la luz de las placas. */
function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

/** Pueblo de 100 vecinos con el ayuntamiento de nivel 3 (lo pide todo lo de la 2.4) y dinero. */
function town(): GameState {
  const s = runSimulation({ seed: 1, days: 300, profile: 'constructor' }).state;
  s.townhallLevel = 3;
  transfer(s, OUTSIDE, TREASURY, 40_000, 'subvencion');
  s.weather = { kind: 'sol', until: s.tick + 30 * 24 };
  return s;
}

/** Casilla libre junto a carretera, cerca del ayuntamiento, donde se puede construir `kind`. */
function spot(s: GameState, kind: 'busstation' | 'residence' | 'solar' | 'nursery'): { x: number; y: number } {
  const th = s.buildings.find((b) => b.kind === 'townhall')!;
  for (let r = 1; r <= 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = th.x + dx;
        const y = th.y + dy;
        if (validateCommand(s, { type: 'Build', kind, x, y }).ok) return { x, y };
      }
  throw new Error(`sin sitio para ${kind}`);
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

async function expectTappable(page: Page, selector: string, n: number) {
  // La ficha se rehace con cada cambio del estado: se mide hasta que los botones estén puestos.
  const smallest = async () => {
    const boxes = await page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    return boxes.length === n ? Math.min(...boxes.map((b: DOMRect) => Math.min(b.width, b.height))) : 0;
  };
  await expect.poll(smallest).toBeGreaterThanOrEqual(44);
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test('2.4: la estación de autobuses se construye desde la bandeja, se cambia el billete y llega el autobús (360 px)', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-vida-${n}.png` });
  const s = town();
  const at = spot(s, 'busstation');
  const hill = s.map.terrain.includes(Terrain.Hill);
  await page.setViewportSize({ width: 360, height: 780 });
  await openTown(page, request, s);

  // La bandeja: las tres categorías nuevas, con precio (y el molino explica si no hay colina).
  await page.locator('#tab-build').click();
  for (const t of ['Cuidados', 'Agua y energía', 'Transporte']) await expect(page.locator('#tray h3', { hasText: t })).toBeVisible();
  await expect(page.locator('#tray [data-tool="residence"] .tool-label')).toHaveText('Residencia');
  await expect(page.locator('#tray [data-tool="busstation"] .tool-cost')).toContainText('€');
  await expect(page.locator('#tray [data-tool="wind"] .tool-cost')).toContainText(hill ? '€' : 'sin colina');
  await page.locator('#tray [data-tool="busstation"]').scrollIntoViewIfNeeded();
  await shot('1-bandeja-360');
  await noOverflow(page);

  // Se construye (en el móvil, con la barra «Construir»).
  await pickTool(page, 'busstation');
  await expect(page.locator('#strip')).toContainText('Una por pueblo');
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [at.x, at.y]);
  const p = await tile(page, at.x, at.y);
  await page.mouse.click(p.x, p.y);
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) {
    await page.waitForTimeout(400);
    await yes.click();
  }
  await chooseOffer(page);
  await expect.poll(async () => (await state(page)).buildings.some((b: { kind: string }) => b.kind === 'busstation'), { timeout: 10_000 }).toBe(true);
  // Solo una por pueblo: la bandeja lo dice.
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray [data-tool="busstation"] .tool-cost')).toContainText('ya la tienes');
  await page.locator('#tab-build').click();

  // Termina la obra.
  await setSpeed(page, 10);
  await expect.poll(async () => (await state(page)).buildings.some((b: { kind: string; built: boolean }) => b.kind === 'busstation' && b.built), { timeout: 120_000, intervals: [1000] }).toBe(true);
  await setSpeed(page, 0);

  // La ficha: usuarios, billete con 3 botones de 44 px y a quién afecta.
  await pickTool(page, 'inspect');
  await inspect(page, at.x, at.y);
  const box = page.locator('.sheet [data-vida="busstation"]');
  await expect(box).toContainText('Usuarios del mes');
  await expect(box).toContainText('A quién afecta');
  await expectTappable(page, '.sheet [data-fare]', 3);
  await expect(page.locator('.sheet [data-fare="normal"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('.sheet [data-fare="caro"]').click();
  await expect.poll(async () => (await state(page)).transit.fare).toBe('caro');
  await expect(page.locator('.sheet [data-fare="caro"]')).toHaveAttribute('aria-checked', 'true');
  await expect(box).toContainText('más descontentos');
  await box.scrollIntoViewIfNeeded();
  await shot('2-estacion-360');
  await noOverflow(page);

  // El autobús circula a x1 (un viaje cada 3 horas de juego, de día).
  await page.locator('.sheet-close').click();
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [at.x, at.y]);
  const trips0 = await page.evaluate(() => (window as any).__bitopolis.busTrips);
  await setSpeed(page, 1);
  await expect.poll(async () => page.evaluate(() => (window as any).__bitopolis.busTrips), { timeout: 30_000 }).toBeGreaterThan(trips0);
  await page.waitForTimeout(1200);
  await shot('3-autobus-360');
  await setSpeed(page, 0);
  expect(errors).toEqual([]);
});

test('2.4: fichas de la residencia (cuota), la guardería y las placas (360 px)', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-vida-${n}.png` });
  const s = town();
  const put = (kind: 'residence' | 'solar' | 'nursery') => {
    const at = spot(s, kind);
    newBuilding(s, kind, at.x, at.y, TREASURY).built = true;
    return at;
  };
  const res = put('residence');
  const nur = put('nursery');
  const sol = put('solar');
  const elders = s.citizens.filter((c) => c.named).slice(0, 2);
  for (const c of elders) {
    c.age = 82;
    c.care = 'residencia';
  }
  await page.setViewportSize({ width: 360, height: 780 });
  await openTown(page, request, s);

  // Residencia: plazas ocupadas, cuota con 3 botones y quién vive allí.
  await inspect(page, res.x, res.y);
  const box = page.locator('.sheet [data-vida="residence"]');
  await expect(box).toContainText('2 de 12 ocupadas');
  await expect(box).toContainText(elders[0]!.name);
  await expectTappable(page, '.sheet [data-fee]', 3);
  await page.locator('.sheet [data-fee="reducida"]').click();
  await expect.poll(async () => (await state(page)).care.residenceFee).toBe('reducida');
  await expect(page.locator('.sheet [data-fee="reducida"]')).toHaveAttribute('aria-checked', 'true');
  await expect(box).toContainText('200 €');
  await box.scrollIntoViewIfNeeded();
  await shot('4-residencia-360');
  await noOverflow(page);
  await page.locator('.sheet-close').click();

  // Guardería: plazas y su propia cuota.
  await inspect(page, nur.x, nur.y);
  await expect(page.locator('.sheet [data-vida="nursery"]')).toContainText('de 20 ocupadas');
  await page.locator('.sheet [data-fee="gratis"]').click();
  await expect.poll(async () => (await state(page)).care.nurseryFee).toBe('gratis');
  await page.locator('.sheet-close').click();

  // Placas: la luz que dan según la estación.
  await inspect(page, sol.x, sol.y);
  const solar = page.locator('.sheet [data-vida="solar"]');
  await expect(solar).toContainText('Hoy: luz para');
  await expect(solar).toContainText('Invierno');
  await solar.scrollIntoViewIfNeeded();
  await shot('5-placas-360');
  expect(errors).toEqual([]);
});
