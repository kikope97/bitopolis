import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, runSimulation, validateCommand } from '../packages/sim/src/index.ts';
import { pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/**
 * 2.8 (ronda 24), parte C: texto grande, horizontal, daltonismo y capas.
 * Capturas en test-results/capturas/v28-pantalla-*.
 */

type Prefs = Record<string, unknown>;

async function newGame(page: Page, prefs: Prefs) {
  await page.addInitScript((p) => localStorage.setItem('bitopolis.prefs', JSON.stringify(p)), prefs);
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
}

let town: Buffer | null = null;
function pack(): Buffer {
  if (!town) {
    const { state: s } = runSimulation({ seed: 4, days: 900, profile: 'constructor', checkEveryDay: false });
    for (const b of s.buildings) {
      delete b.fire;
      delete b.risk;
    }
    town = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: (s as GameState).formatVersion, exportedAt: '', mode: 'normal', state: s }));
  }
  return town;
}
async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, prefs: Prefs) {
  await page.addInitScript((p) => localStorage.setItem('bitopolis.prefs', JSON.stringify(p)), prefs);
  const { token } = await (await request.post('/api/import', { data: pack(), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
  for (let i = 0; i < 3 && (await page.locator('.sheet-close').first().isVisible()); i++) await page.locator('.sheet-close').first().click();
}

async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] } as never);
  return async (x: number, y: number) => {
    await send('touchStart', x, y);
    await send('touchEnd', x, y);
  };
}
async function touchTile(page: Page, tap: (x: number, y: number) => Promise<void>, x: number, y: number, done: () => Promise<boolean>) {
  for (let i = 0; i < 3; i++) {
    await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);
    const p = await tile(page, x, y);
    await tap(p.x, p.y);
    await page.waitForTimeout(400);
    if (await done()) return;
  }
}

/** Parte del mapa que queda a la vista (sin la franja, el tutorial ni los avisos), sobre el sitio que tiene entre las barras. */
async function mapShare(page: Page) {
  return page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const map = r('#map')!;
    const bar = r('.topbar')!;
    const dock = r('#dock')!;
    const strip = r('#strip')!;
    const side = dock.height > dock.width;
    const room = (window.innerWidth - (side ? dock.width : 0)) * (window.innerHeight - bar.height - (side ? 0 : dock.height));
    const top = Math.max(map.top, bar.bottom);
    const bottom = Math.min(map.bottom, strip.top);
    const area = Math.max(0, bottom - top) * map.width;
    let covered = 0;
    for (const sel of ['.tut-box', '#toasts .toast']) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el || el.hidden || !el.offsetParent) continue;
      const o = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(o.right, map.right) - Math.max(o.left, map.left));
      const h = Math.max(0, Math.min(o.bottom, bottom) - Math.max(o.top, top));
      covered += w * h;
    }
    return { share: (area - covered) / room, stripH: strip.height, tutH: r('.tut-box')?.height ?? 0 };
  });
}

for (const size of [
  { name: 'horiz', w: 740, h: 360 },
  { name: '360', w: 360, h: 740 },
]) {
  test(`2.8: a ${size.name} con el texto al 200 % y una obra propuesta, se ve al menos el 40 % del mapa`, async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium' || info.project.name !== 'movil', 'toques por CDP en el móvil');
    test.setTimeout(90_000);
    await page.setViewportSize({ width: size.w, height: size.h });
    await newGame(page, { text: 200 });
    await setSpeed(page, 0);
    // El tutorial sigue puesto (es una partida nueva): con la letra grande va en columna y dentro de su tope.
    await expect(page.locator('.tut-box')).toBeVisible();
    const tut = await page.locator('.tut-box').evaluate((el) => ({ h: el.getBoundingClientRect().height, dir: getComputedStyle(el).flexDirection }));
    expect(tut.dir).toBe('column');
    expect(tut.h, 'el tutorial no pasa del 28 % del alto').toBeLessThanOrEqual(size.h * 0.28 + 2);
    const s = (await state(page)) as GameState;
    const th = s.buildings.find((b) => b.kind === 'townhall')!;
    let at: { x: number; y: number } | null = null;
    for (let r = 1; r < 8 && !at; r++) for (let y = th.y - r; y <= th.y + r && !at; y++) for (let x = th.x - r; x <= th.x + r && !at; x++) if (validateCommand(s, { type: 'Build', kind: 'water', x, y }).ok) at = { x, y };
    expect(at).not.toBeNull();
    await pickTool(page, 'water');
    const tap = await touch(page);
    await touchTile(page, tap, at!.x, at!.y, () => page.locator('#confirm-yes').isVisible());
    await expect(page.locator('#confirm-yes')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/capturas/v28-pantalla-${size.name}-200-confirmar.png` });
    // Texto arriba (a todo el ancho) y los botones en una fila debajo.
    const lay = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return { text: r('#confirm-text'), yes: r('#confirm-yes'), no: r('#confirm-no'), bar: r('#confirm-bar') };
    });
    expect(lay.yes.top, 'los botones van debajo del texto').toBeGreaterThanOrEqual(lay.text.bottom - 1);
    expect(Math.abs(lay.yes.top - lay.no.top), 'en una fila').toBeLessThan(2);
    expect(lay.text.width, 'el texto ocupa el ancho de la franja').toBeGreaterThan(lay.bar.width * 0.8);
    expect(lay.bar.height, 'la franja no pasa del 28 % del alto').toBeLessThanOrEqual(size.h * 0.28 + 2);
    expect(lay.yes.bottom, '«Construir» se ve entero').toBeLessThanOrEqual(size.h);
    // Con la herramienta elegida, el tutorial se pliega a una línea.
    const folded = await page.locator('.tut-box p').evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(folded).toBe('nowrap');
    const m = await mapShare(page);
    expect(m.share, `mapa a la vista (franja ${m.stripH} px, tutorial ${m.tutH} px)`).toBeGreaterThanOrEqual(0.4);
  });
}

test('2.8: donde no se puede construir, una ✗ blanca sobre la casilla', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium' || info.project.name !== 'movil', 'toques por CDP en el móvil');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await newGame(page, {});
  await skipTutorial(page);
  await setSpeed(page, 0);
  const st = (await state(page)) as GameState;
  const th = st.buildings.find((b) => b.kind === 'townhall')!;
  await pickTool(page, 'house');
  const tap = await touch(page);
  await touchTile(page, tap, th.x, th.y, async () => ((await page.locator('#confirm-text').textContent()) ?? '').includes('no se puede'));
  await expect(page.locator('#confirm-text')).toContainText('no se puede');
  await page.waitForTimeout(300);
  const px = await page.evaluate(([x, y]) => {
    const c = document.querySelector<HTMLCanvasElement>('#map')!;
    const r = c.getBoundingClientRect();
    const p = (window as any).__bitopolis.tileCenter(x, y) as { x: number; y: number };
    const k = c.width / r.width;
    return [...c.getContext('2d')!.getImageData(Math.round((p.x - r.left) * k), Math.round((p.y - r.top) * k), 1, 1).data].slice(0, 3);
  }, [th.x, th.y]);
  expect(px, 'el centro de la casilla es blanco (la ✗)').toEqual([244, 244, 244]);
});

test('2.8: con una hoja abierta, el aviso no tapa su cabecera (móvil y escritorio)', async ({ page }, info) => {
  test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 360, height: 740 });
  await newGame(page, { text: 150 });
  await skipTutorial(page);
  await setSpeed(page, 0);
  const overlap = () =>
    page.evaluate(() => {
      const t = document.querySelector('#toasts .toast')?.getBoundingClientRect();
      const hd = document.querySelector('.sheet .sheet-head')?.getBoundingClientRect();
      if (!t || !hd) return 'falta';
      const x = Math.min(t.right, hd.right) - Math.max(t.left, hd.left);
      const y = Math.min(t.bottom, hd.bottom) - Math.max(t.top, hd.top);
      return x > 0 && y > 0 ? 'tapa' : 'ok';
    });
  // Una hoja (Dinero) y, encima, el aviso de x10 (sale una vez por sesión, sin acción: se ve arriba).
  await page.locator('#hud-money').click();
  await expect(page.locator('.sheet')).toBeVisible();
  await page.waitForTimeout(300);
  for (let i = 0; i < 3 && (await page.locator('#speed').textContent()) !== 'x10'; i++) await page.locator('#speed').click();
  await expect(page.locator('#toasts .toast')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/capturas/v28-pantalla-aviso-hoja-media.png' });
  expect(await overlap(), 'hoja media').toBe('ok');
  // Hoja completa (hasta la barra de arriba): el aviso va debajo de su cabecera.
  await page.locator('.sheet').evaluate((el) => (el.dataset.snap = 'full'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/capturas/v28-pantalla-aviso-hoja-completa.png' });
  if (await page.locator('#toasts .toast').isVisible()) expect(await overlap(), 'hoja completa').toBe('ok');
  // La hoja baja a asomada: el aviso se recoloca encima de su borde.
  await page.locator('.sheet').evaluate((el) => (el.dataset.snap = 'peek'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/capturas/v28-pantalla-aviso-hoja-peek.png' });
  if (await page.locator('#toasts .toast').isVisible()) {
    expect(await overlap(), 'hoja asomada').toBe('ok');
    const r = await page.evaluate(() => ({ t: document.querySelector('#toasts')!.getBoundingClientRect().bottom, s: document.querySelector('.sheet')!.getBoundingClientRect().top }));
    expect(r.t, 'encima del borde de la hoja').toBeLessThanOrEqual(r.s + 1);
  }
  await setSpeed(page, 0);
  // Escritorio: el panel lateral; el aviso, fuera de él (otra visita: el aviso de x10 vuelve a salir).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await setSpeed(page, 0);
  await page.locator('#hud-money').click();
  await expect(page.locator('.sheet')).toBeVisible();
  for (let i = 0; i < 3 && (await page.locator('#speed').textContent()) !== 'x10'; i++) await page.locator('#speed').click();
  await expect(page.locator('#toasts .toast')).toBeVisible();
  const r = await page.evaluate(() => ({ t: document.querySelector('#toasts .toast')!.getBoundingClientRect().right, s: document.querySelector('.sheet')!.getBoundingClientRect().left }));
  expect(r.t, 'el aviso queda fuera del panel').toBeLessThanOrEqual(r.s + 1);
  await setSpeed(page, 0);
});

test('2.8: «Rojo-verde» cambia la rampa de las capas y los verdes fijos; capas de Ruido y Delincuencia', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'escritorio', 'una vez basta');
  test.setTimeout(120_000);
  await openTown(page, request, { colorblind: 'rojo-verde' });
  // La barra R de la franja ya no es verde.
  expect(await page.locator('.bar-r').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(244, 244, 244)');
  const swatch = (lv: number) => page.locator(`.legend-item.lv${lv}`).evaluate((el) => getComputedStyle(el, '::before').backgroundImage);
  // Capas nuevas en la hoja «Capas».
  await page.locator('#layers').click();
  for (const name of ['Ruido', 'Delincuencia']) await expect(page.locator('.layers-sheet').getByRole('radio', { name })).toBeVisible();
  await page.locator('.layers-sheet').getByRole('radio', { name: 'Delincuencia' }).click();
  await expect(page.locator('#legend')).toBeVisible();
  await expect(page.locator('#legend')).toContainText('Delincuencia');
  if ((await page.locator('.legend-item').count()) === 0 || !(await page.locator('.legend-item').first().isVisible())) await page.locator('.legend-head').click();
  await expect(page.locator('.legend-item')).toHaveCount(4);
  // Lo malo, de blanco a azul oscuro (sin rojo ni naranja).
  expect(await swatch(3)).toContain('rgb(41, 54, 111)');
  await page.screenshot({ path: 'test-results/capturas/v28-pantalla-delincuencia-rojo-verde.png' });
  await page.locator('#layers').click();
  await page.locator('.layers-sheet').getByRole('radio', { name: 'Ruido' }).click();
  await expect(page.locator('#legend')).toContainText('Ruido');
  await page.locator('#layers').click();
  await page.locator('.layers-sheet').getByRole('radio', { name: 'Felicidad de los vecinos' }).click();
  if (!(await page.locator('.legend-item').first().isVisible())) await page.locator('.legend-head').click();
  // Lo bueno sube de azul oscuro a amarillo; el nivel alto, a rayas como en el mapa.
  expect(await swatch(0)).toContain('rgb(41, 54, 111)');
  expect(await swatch(3)).toContain('rgb(255, 205, 117)');
  expect(await swatch(3)).toContain('repeating-linear-gradient');
  await page.screenshot({ path: 'test-results/capturas/v28-pantalla-felicidad-rojo-verde.png' });
});

test('2.8: la barra de arriba deja 👥 para lo último, «Guardado» con forma y chips de 44 px', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 740 });
  await openTown(page, request, { text: 200 });
  await page.screenshot({ path: 'test-results/capturas/v28-pantalla-barra-360-200.png' });
  // En cada tamaño: si los vecinos se van a «⋯», antes se han ido la felicidad y el calendario.
  for (const [w, hgt] of [[390, 844], [360, 740], [320, 568]] as const) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.waitForTimeout(400);
    const v = await page.evaluate(() => {
      const shown = (s: string) => !!document.querySelector<HTMLElement>(s)?.offsetParent;
      return { pop: shown('#hud-pop'), happy: shown('#hud-happy'), cal: shown('#calendar') };
    });
    if (!v.pop) expect(v.happy || v.cal, `a ${w} px, la felicidad y el calendario se van antes que los vecinos`).toBe(false);
    if (v.happy) expect(v.pop, `a ${w} px`).toBe(true);
  }
  // Con la letra al 150 % en 390 px, ya caben los vecinos (antes se iban los primeros a «⋯»).
  await page.evaluate(() => (document.documentElement.dataset.text = '150'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await expect(page.locator('#hud-pop')).toBeVisible();
  // «Guardado»: un círculo (no solo un color).
  await page.setViewportSize({ width: 360, height: 740 });
  const dot = await page.locator('#saved').evaluate((el) => getComputedStyle(el, '::before').borderRadius);
  expect(dot).toBe('50%');
  // Bandeja: chips de 44 px y la cabecera fija deja sitio a la carta.
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray')).toBeVisible();
  const chips = await page.locator('.tray-chip:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(Math.min(...chips)).toBeGreaterThanOrEqual(43.5);
  const pad = await page.locator('#tray').evaluate((el) => ({ pad: parseFloat(getComputedStyle(el).scrollPaddingTop), head: el.querySelector<HTMLElement>('.tray-head')!.offsetHeight }));
  expect(pad.pad, 'scroll-padding-top cubre la cabecera fija').toBeGreaterThanOrEqual(pad.head - 2);
});
