import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, runSimulation } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial } from './helpers.ts';

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

/** Arrastre con el dedo de verdad (eventos táctiles por CDP, como e2e/tactil.spec.ts). */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] } as never);
  return async (x: number, y0: number, y1: number) => {
    await send('touchStart', x, y0);
    for (let i = 1; i <= 10; i++) await send('touchMove', x, y0 + ((y1 - y0) * i) / 10);
    await send('touchEnd', x, y1);
    await page.waitForTimeout(300);
  };
}

const sheetBox = (page: Page) => page.locator('.sheet').evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, height: r.height, snap: (el as HTMLElement).dataset.snap ?? '' };
});

test('2.7: la ficha abre asomada, el asa sube y baja de altura, abajo se cierra y la cámara vuelve', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'movil', 'hace falta pantalla táctil');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, request, 100);
  const s = await page.evaluate(() => (window as unknown as { __bitopolis: { state: GameState } }).__bitopolis.state);
  const house = s.buildings.find((b) => b.kind === 'house' && b.built)!;
  await page.locator('#tab-inspect').click();
  const cam0 = await page.evaluate(([x, y]) => (window as unknown as { __bitopolis: { tileCenter(a: number, b: number): { x: number; y: number } } }).__bitopolis.tileCenter(x!, y!), [house.x, house.y]);
  await page.mouse.click(cam0.x, cam0.y);
  await expect(page.locator('.sheet.ficha')).toBeVisible();
  await page.waitForTimeout(300);
  const peek = await sheetBox(page);
  expect(peek.height, 'asomada: el mapa queda a la vista').toBeLessThan(844 * 0.4);
  await page.screenshot({ path: `test-results/capturas/movil2-hoja-asomada.png` });
  const drag = await finger(page);
  const gripX = 195;
  // Hacia arriba: media y luego completa (sin tapar la barra de arriba).
  await drag(gripX, peek.top + 8, peek.top - 220);
  expect((await sheetBox(page)).snap).toBe('mid');
  const mid = await sheetBox(page);
  await drag(gripX, mid.top + 8, 40);
  const full = await sheetBox(page);
  expect(full.snap).toBe('full');
  const barBottom = await page.locator('.topbar').evaluate((el) => el.getBoundingClientRect().bottom);
  expect(full.top, 'la completa no tapa la barra de arriba').toBeGreaterThanOrEqual(barBottom - 1);
  await page.screenshot({ path: `test-results/capturas/movil2-hoja-completa.png` });
  // Hacia abajo, escalón a escalón: media, asomada y cerrada.
  await drag(gripX, full.top + 8, full.top + 200);
  expect((await sheetBox(page)).snap).toBe('mid');
  await drag(gripX, (await sheetBox(page)).top + 8, (await sheetBox(page)).top + 200);
  expect((await sheetBox(page)).snap).toBe('peek');
  await drag(gripX, (await sheetBox(page)).top + 8, 830);
  await expect(page.locator('.sheet')).toHaveCount(0);
  // La cámara vuelve: la casa está donde se tocó.
  const back = await page.evaluate(([x, y]) => (window as unknown as { __bitopolis: { tileCenter(a: number, b: number): { x: number; y: number } } }).__bitopolis.tileCenter(x!, y!), [house.x, house.y]);
  expect(Math.abs(back.x - cam0.x) + Math.abs(back.y - cam0.y)).toBeLessThan(2);
  // Con Dinero abierto se marca «Pueblo», no «Mirar».
  await page.locator('#hud-money').click();
  await expect(page.locator('.sheet')).toBeVisible();
  const tabs = await page.evaluate(() => ['#tab-inspect', '#menu'].map((s) => getComputedStyle(document.querySelector(`${s} .tab-label`)!).color));
  expect(tabs[0]).not.toBe(tabs[1]);
  expect(tabs[1]).toBe('rgb(255, 205, 117)');
});

test('2.7: en horizontal (740×360), el dock es un riel con nombre y las hojas van al otro lado sin tapar la barra', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'movil', 'móvil girado');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 740, height: 360 });
  await open(page, request, 100);
  const dock = await page.locator('#dock').boundingBox();
  expect(dock!.width, 'riel de 56 px o más').toBeGreaterThanOrEqual(56);
  expect(dock!.x + dock!.width).toBeLessThanOrEqual(741);
  for (const t of await page.locator('.dock .tab').all()) {
    const b = (await t.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    const label = await t.locator('.tab-label').evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, sw: el.scrollWidth, text: (el as HTMLElement).innerText.trim() }));
    expect(label.text.length, 'cada pestaña lleva su nombre').toBeGreaterThan(2);
    expect(label.sw, 'el nombre no se corta').toBeLessThanOrEqual(label.w + 1);
  }
  const bar = (await page.locator('.topbar').boundingBox())!;
  const s = await page.evaluate(() => (window as unknown as { __bitopolis: { state: GameState } }).__bitopolis.state);
  const th = s.buildings.find((b) => b.kind === 'townhall')!;
  const p = await page.evaluate(([x, y]) => (window as unknown as { __bitopolis: { tileCenter(a: number, b: number): { x: number; y: number } } }).__bitopolis.tileCenter(x!, y!), [th.x, th.y]);
  await page.locator('#tab-inspect').click();
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.sheet h2')).toHaveText('Gestión del pueblo');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/capturas/movil2-horiz-gestion.png` });
  const sh = (await page.locator('.sheet').boundingBox())!;
  expect(sh.y, 'no tapa la barra de arriba').toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect(sh.x + sh.width, 'va al otro lado del riel').toBeLessThanOrEqual(dock!.x);
  expect(sh.width, 'no es pantalla completa').toBeLessThan(740 - dock!.width - 100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
