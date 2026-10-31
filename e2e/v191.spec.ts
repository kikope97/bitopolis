import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { applyCommand, commandOutlay, createInitialState, type GameState, OUTSIDE, runSimulation, transfer, TREASURY, validateCommand } from '../packages/sim/src/index.ts';
import { skipTutorial, state as gameState, tile } from './helpers.ts';

/** v1.9.1: pendientes de las rondas 14 y 15 (aviso de caja, tutorial, inicio al 200 %, leyenda, ficha). */
function pack(state: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

async function importTown(request: import('@playwright/test').APIRequestContext, state: GameState): Promise<string> {
  const { token } = await (await request.post('/api/import', { data: pack(state), headers: { 'content-type': 'application/octet-stream' } })).json();
  return token as string;
}

function spot(s: GameState, kind: 'house' | 'water', not?: { x: number; y: number }) {
  const th = s.buildings.find((b) => b.kind === 'townhall')!;
  for (let r = 1; r < 8; r++) {
    for (let y = th.y - r; y <= th.y + r; y++) {
      for (let x = th.x - r; x <= th.x + r; x++) {
        if (not && not.x === x && not.y === y) continue;
        if (validateCommand(s, { type: 'Build', kind, x, y }).ok) return { x, y };
      }
    }
  }
  throw new Error('sin sitio');
}

async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] } as never);
  return async (x: number, y: number) => {
    await send('touchStart', x, y);
    await send('touchEnd', x, y);
  };
}

test('v1.9.1: la barra de confirmar avisa si la caja quedaría en negativo; en el tutorial, tras la primera casa vuelve «Mirar»', async ({ page, request, browserName }, info) => {
  test.skip(browserName !== 'chromium' || info.project.name !== 'movil', 'toques por CDP en el móvil');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s = createInitialState({ seed: 7 });
  const w = spot(s, 'water');
  expect(applyCommand(s, { type: 'Build', kind: 'water', ...w }).ok).toBe(true);
  const at = spot(s, 'house', w);
  const outlay = commandOutlay(s, { type: 'Build', kind: 'house', ...at });
  // Llega justo para la casa, pero no para la casa y lo que falta de la bomba.
  transfer(s, TREASURY, OUTSIDE, s.treasury - (outlay + 200), 'obras');
  const token = await importTown(request, s);
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('.tut-box')).toBeVisible();

  // Con la bandeja abierta, el cuadro del tutorial va abajo y no tapa el motivo de la bandeja.
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray')).toBeVisible();
  const msg = (await page.locator('#tray .tray-msg').boundingBox())!;
  const box = (await page.locator('.tut-box').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(msg.y + msg.height);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v191-1-bandeja-tutorial.png` });
  await page.locator('#tray [data-tool="house"]').click();

  const tap = await touch(page);
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [at.x, at.y]);
  const p = await tile(page, at.x, at.y);
  await tap(p.x, p.y);
  await expect(page.locator('#confirm-bar')).toBeVisible();
  await expect(page.locator('#confirm-text .cc-warn')).toContainText(/⚠ Quedarías en −\d/);
  await expect(page.locator('#confirm-text')).toContainText('con las obras en marcha');
  // Solo avisa: se puede construir igual.
  await expect(page.locator('#confirm-yes')).toBeEnabled();
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v191-2-aviso-caja.png` });
  await page.waitForTimeout(400);
  await page.locator('#confirm-yes').click();
  await expect.poll(async () => (await gameState(page)).buildings.some((b: { kind: string }) => b.kind === 'house')).toBe(true);
  await expect(page.locator('#tab-inspect')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('v1.9.1: el tutorial hace destellar el ayuntamiento; «Nivel 1 · Ampliar» en el panel Pueblo abre la gestión', async ({ page, request }, info) => {
  const { state } = runSimulation({ seed: 2, days: 120, profile: 'pasivo' });
  state.townhallLevel = 1;
  while (state.citizens.length < 10) state.citizens.push({ ...state.citizens[0]!, id: state.nextId++, homeId: null, jobId: null, named: false, money: 0, debt: undefined, relations: [] });
  const token = await importTown(request, state);
  // El tutorial va por el paso «Toca el ayuntamiento…».
  await page.addInitScript((t) => localStorage.setItem(`bitopolis.tut.${t}`, '7'), token);
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('.tut-box')).toContainText('destella');
  const hall = state.buildings.find((b) => b.kind === 'townhall')!;
  await expect.poll(() => page.evaluate(() => (window as any).__bitopolis.highlight)).toEqual({ x: hall.x, y: hall.y });
  // La cámara va al ayuntamiento: queda dentro del mapa a la vista.
  await page.waitForTimeout(1200);
  const c = await tile(page, hall.x, hall.y);
  const map = (await page.locator('#map').boundingBox())!;
  expect(c.x).toBeGreaterThan(map.x);
  expect(c.x).toBeLessThan(map.x + map.width);
  expect(c.y).toBeGreaterThan(map.y);
  expect(c.y).toBeLessThan(map.y + map.height);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v191-3-destello.png` });
  await skipTutorial(page);

  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Nivel 1 · Ampliar/ }).click();
  await expect(page.locator('.sheet.full')).toBeVisible();
  await expect(page.locator('.sheet-back')).toBeVisible();
});

test('v1.9.1: inicio con texto al 200 % en 360 px: título y resumen enteros, «Continuar» a mano', async ({ browser, request }, info) => {
  const { state } = runSimulation({ seed: 3, days: 200, profile: 'constructor', checkEveryDay: false });
  const token = await importTown(request, state);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, baseURL: info.project.use.baseURL });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('bitopolis.prefs', JSON.stringify({ text: 200 })));
  await page.goto(`/p/${token}`);
  await expect(page.locator('html')).toHaveAttribute('data-text', '200');
  await expect(page.locator('.stats-card')).toBeVisible();
  const logo = page.locator('.logo');
  expect(await logo.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const lb = (await logo.boundingBox())!;
  expect(lb.x).toBeGreaterThanOrEqual(0);
  expect(lb.x + lb.width).toBeLessThanOrEqual(360);
  for (const dd of await page.locator('.stats-card dd').all()) {
    const b = (await dd.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(361);
  }
  // «Continuar» se ve sin desplazarse y se puede tocar.
  const play = (await page.locator('#play').boundingBox())!;
  expect(play.y + play.height).toBeLessThanOrEqual(640);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v191-4-inicio-200.png` });
  await page.locator('#play').tap();
  await expect(page.locator('#game')).toBeVisible();
  await ctx.close();
});

test('v1.9.1: en horizontal la leyenda de «Qué falta» empieza plegada y no pasa del 45 % del ancho', async ({ browser, request }, info) => {
  const { state } = runSimulation({ seed: 3, days: 300, profile: 'constructor', checkEveryDay: false });
  const token = await importTown(request, state);
  const ctx = await browser.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, baseURL: info.project.use.baseURL });
  const page = await ctx.newPage();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await page.locator('#layers').click();
  await page.getByRole('radio', { name: 'Qué falta' }).click();
  await expect(page.locator('#legend .legend-head')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#legend .legend-head').click();
  await expect(page.locator('#legend .legend-head')).toHaveAttribute('aria-expanded', 'true');
  const lg = (await page.locator('#legend').boundingBox())!;
  const map = (await page.locator('#map').boundingBox())!;
  expect(lg.width).toBeLessThanOrEqual(map.width * 0.45 + 1);
  expect(lg.y + lg.height).toBeLessThanOrEqual(map.y + map.height + 1);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v191-5-leyenda-horizontal.png` });
  await ctx.close();
});

test('v1.9.1: los servicios de la casa son una lista de definición', async ({ page, request }) => {
  const { state } = runSimulation({ seed: 3, days: 500, profile: 'constructor', checkEveryDay: false });
  const house = state.buildings.find((b) => b.kind === 'house' && b.built)!;
  const token = await importTown(request, state);
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [house.x, house.y]);
  const p = await tile(page, house.x, house.y);
  await page.mouse.click(p.x, p.y);
  const dl = page.locator('.sheet dl.svc-table');
  await expect(dl).toBeVisible();
  await expect(dl.locator('dt').first()).toHaveText('Agua');
  expect(await dl.locator('dd').count()).toBe(await dl.locator('dt').count());
});
