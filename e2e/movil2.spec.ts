import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { commandOutlay, createInitialState, type GameState, OUTSIDE, runSimulation, transfer, TREASURY, validateCommand } from '../packages/sim/src/index.ts';
import { pickTool, setSpeed, skipTutorial, tile } from './helpers.ts';

/**
 * 2.7 «Interfaz móvil 2.0»: requisitos que se miden (docs/propuestas/v2.7-interfaz-movil.md).
 * La barra de arriba en una fila, todo lo que se toca de 44 px o más, nada fuera de la pantalla
 * y el texto al 200 % sin quitar etiquetas. Capturas en test-results/capturas/movil2-*.
 */
let town: Buffer | null = null;
function pack(): Buffer {
  if (!town) {
    const { state: s } = runSimulation({ seed: 4, days: 1200, profile: 'constructor', checkEveryDay: false });
    for (const b of s.buildings) {
      delete b.fire;
      delete b.risk;
    }
    town = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: (s as GameState).formatVersion, exportedAt: '', mode: 'normal', state: s }));
  }
  return town;
}

const SIZES = [
  { name: '360', w: 360, h: 740 },
  { name: '390', w: 390, h: 844 },
  { name: '320', w: 320, h: 568 },
  { name: 'horiz', w: 740, h: 360 },
  { name: 'tableta', w: 768, h: 1024 },
];

async function open(page: Page, request: import('@playwright/test').APIRequestContext, text: 100 | 200) {
  await page.addInitScript((t) => localStorage.setItem('bitopolis.prefs', JSON.stringify({ text: t })), text);
  const { token } = await (await request.post('/api/import', { data: pack(), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
  // «Mientras no estabas» u otras hojas de bienvenida: fuera.
  for (let i = 0; i < 3 && (await page.locator('.sheet-close').first().isVisible()); i++) await page.locator('.sheet-close').first().click();
}

/** Lo que se toca y mide menos de 44 px (alto o ancho), dentro de `scope`. */
async function smallTargets(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button, ${sel} [role="button"], ${sel} a[href]`)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.id || el.className || el.textContent?.trim().slice(0, 20)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}

for (const size of SIZES) {
  for (const text of [100, 200] as const) {
    test(`2.7: pantalla de juego a ${size.name} con el texto al ${text} %`, async ({ page, request }, info) => {
      test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
      test.setTimeout(120_000);
      await page.setViewportSize({ width: size.w, height: size.h });
      await open(page, request, text);
      await page.screenshot({ path: `test-results/capturas/movil2-${size.name}-${text}-juego.png` });
      // La barra de arriba, en una sola fila y sin desbordar.
      const bar = await page.locator('.topbar').evaluate((el) => ({ h: el.getBoundingClientRect().height, over: el.scrollWidth - el.clientWidth }));
      expect(bar.over, 'la barra de arriba no se sale').toBeLessThanOrEqual(1);
      expect(bar.h, 'la barra de arriba va en una fila').toBeLessThan(text === 200 ? 80 : 64);
      // Nada se sale de la pantalla por los lados.
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(wide).toBeLessThanOrEqual(0);
      // Todo lo que se toca en la barra, el dock y los botones del mapa: 44 px o más.
      expect(await smallTargets(page, '.topbar')).toEqual([]);
      expect(await smallTargets(page, '.dock')).toEqual([]);
      expect(await smallTargets(page, '.map-btns')).toEqual([]);
      // Las pestañas del dock nunca se quedan sin nombre.
      const labels = await page.locator('.dock .tab-label').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetWidth > 0 && (e.textContent ?? '').trim().length > 0));
      expect(labels.every(Boolean), 'cada pestaña lleva su nombre').toBe(true);
    });
  }
}

/* ---------- 2.7 «Construir y el dinero» ---------- */

async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] } as never);
  return async (x: number, y: number) => {
    await send('touchStart', x, y);
    await send('touchEnd', x, y);
  };
}

/** Toca la casilla con el dedo; si el primer toque solo acerca el mapa, otra vez. */
async function touchTile(page: Page, tap: (x: number, y: number) => Promise<void>, x: number, y: number, done: () => Promise<boolean>) {
  for (let i = 0; i < 3; i++) {
    await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);
    const p = await tile(page, x, y);
    await tap(p.x, p.y);
    await page.waitForTimeout(400);
    if (await done()) return;
  }
}

for (const size of [SIZES[0]!, SIZES[1]!]) {
  test(`2.7: bandeja «Construir» a ${size.name}: chips en una fila, 3 columnas y como mucho el 55 % del alto`, async ({ page, request }, info) => {
    test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
    test.setTimeout(120_000);
    await page.setViewportSize({ width: size.w, height: size.h });
    await open(page, request, 100);
    await page.locator('#tab-build').click();
    const tray = page.locator('#tray');
    await expect(tray).toBeVisible();
    const box = (await tray.boundingBox())!;
    expect(box.height, 'la bandeja ocupa como mucho el 55 % del alto').toBeLessThanOrEqual(size.h * 0.55 + 1);
    // Por encima de la bandeja se ve el mapa.
    const map = (await page.locator('#map').boundingBox())!;
    expect(box.y - map.y, 'el mapa se ve sobre la bandeja').toBeGreaterThan(size.h * 0.2);
    // Chips de categoría en una sola fila, que se desplaza de lado.
    const chips = page.locator('.tray-chip:visible');
    expect(await chips.count()).toBeGreaterThanOrEqual(3);
    const tops = await chips.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size, 'los chips van en una fila').toBe(1);
    expect(await page.locator('.tray-chips').evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
    // Tarjetas en 3 columnas.
    const cols = await page.locator('#tray details[open] .tray-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(3);
    // El coste al mes es un gasto («−…/mes»).
    await expect(page.locator('#tray [data-tool="water"] .tool-month')).toHaveText(/^−\d[\d.]* €\/mes$/);
    // Un chip lleva a su categoría y queda marcado.
    const chip = page.locator('.tray-chip[data-cat="Emergencias"]');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-current', 'true');
    await page.waitForTimeout(500);
    const cat = (await page.locator('#tray details[data-cat="Emergencias"]').boundingBox())!;
    expect(cat.y).toBeGreaterThanOrEqual(box.y);
    expect(cat.y).toBeLessThan(box.y + box.height);
    await page.screenshot({ path: `test-results/capturas/movil2-${size.name}-bandeja.png` });
    // `pickTool` sigue sirviendo (abre la categoría y elige).
    await pickTool(page, 'park');
    await expect(page.locator('#tool-info')).toContainText('Parque');
  });
}

test('2.7: aviso de caja en «Construir / ✕» si tras la obra aguanta menos de 2 meses', async ({ page, request, browserName }, info) => {
  test.skip(browserName !== 'chromium' || info.project.name !== 'movil', 'toques por CDP en el móvil');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 360, height: 740 });
  const s = createInitialState({ seed: 7 });
  const th = s.buildings.find((b) => b.kind === 'townhall')!;
  let at: { x: number; y: number } | null = null;
  for (let r = 1; r < 8 && !at; r++) for (let y = th.y - r; y <= th.y + r && !at; y++) for (let x = th.x - r; x <= th.x + r && !at; x++) if (validateCommand(s, { type: 'Build', kind: 'house', x, y }).ok) at = { x, y };
  const outlay = commandOutlay(s, { type: 'Build', kind: 'house', ...at! });
  // Un mes cerrado en negativo (entran 500 €, el gasto corriente es de 2.500 €) y la caja justa para la casa y poco más.
  s.stats.push({ month: 0, population: 3, treasury: s.treasury, happiness: 60, income: 500, expenses: 2_500, breakdown: { IBI: 500, mantenimiento: -2_500 } });
  transfer(s, TREASURY, OUTSIDE, s.treasury - (outlay + 1_500), 'subvencion');
  const data = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
  const { token } = await (await request.post('/api/import', { data, headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
  await pickTool(page, 'house');
  const tap = await touch(page);
  await touchTile(page, tap, at!.x, at!.y, () => page.locator('#confirm-bar').isVisible());
  await expect(page.locator('#confirm-bar')).toBeVisible();
  await expect(page.locator('[data-test="cc-runway"]')).toContainText(/Tras esta obra, la caja aguanta (menos de un mes|1 mes)/);
  // La obra, explicada: lo que se paga ahora y lo que irá en obreros.
  await expect(page.locator('#confirm-text .cc-cost')).toContainText('ahora + hasta');
  await page.screenshot({ path: 'test-results/capturas/movil2-360-aviso-caja.png' });
  await page.waitForTimeout(400);
  await page.locator('#confirm-no').click();
  await expect(page.locator('#confirm-bar')).toBeHidden();

  // Una casilla ocupada (el ayuntamiento): la barra dice por qué y no ofrece «Construir».
  await touchTile(page, tap, th.x, th.y, () => page.locator('#confirm-bar').isVisible());
  await expect(page.locator('#confirm-text')).toContainText('no se puede');
  await expect(page.locator('#confirm-yes')).toBeHidden();
});

test('2.7: una calle suelta avisa de que no está unida al agua ni a la luz', async ({ page, request, browserName }, info) => {
  test.skip(browserName !== 'chromium' || info.project.name !== 'movil', 'toques por CDP en el móvil');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, request, 100);
  const st = (await page.evaluate(() => (window as any).__bitopolis.state)) as GameState;
  const { w, h } = st.map;
  const free = (x: number, y: number) =>
    x > 1 && y > 1 && x < w - 2 && y < h - 2 && st.map.tiles[y * w + x] === 0 && !st.map.terrain?.[y * w + x] && !st.buildings.some((b) => Math.abs(b.x - x) <= 2 && Math.abs(b.y - y) <= 2);
  const near = (x: number, y: number) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => st.map.tiles[(y + dy!) * w + x + dx!] === 1);
  let at: { x: number; y: number } | null = null;
  for (let y = 2; y < h - 2 && !at; y++) for (let x = 2; x < w - 4 && !at; x++) if ([0, 1, 2].every((d) => free(x + d, y) && !near(x + d, y))) at = { x, y };
  expect(at, 'hay sitio para una calle suelta').not.toBeNull();
  await page.locator('#tab-road').click();
  const tap = await touch(page);
  await touchTile(page, tap, at!.x, at!.y, async () => ((await page.locator('#confirm-text').textContent()) ?? '').includes('inicio marcado'));
  await touchTile(page, tap, at!.x + 2, at!.y, () => page.locator('#confirm-yes').isVisible());
  await expect(page.locator('[data-test="cc-network"]')).toContainText('no está unida al agua ni a la luz');
  await page.screenshot({ path: 'test-results/capturas/movil2-360-calle-suelta.png' });
});
