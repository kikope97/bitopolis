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
/* ---------- 2.7: accesibilidad, leyendas y capas, inicio y tutorial ---------- */

/**
 * Contraste (WCAG) de cada texto visible dentro de `scopes`, con su color calculado y el fondo del primer
 * antepasado que lo tenga opaco; y el tamaño: ningún texto por debajo de `minPx`.
 */
async function textAudit(page: Page, scopes: string[], minPx: number) {
  return page.evaluate(
    ([sel, min]) => {
      const rgb = (c: string) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = '1'] = m[1]!.split(/[ ,/]+/).filter(Boolean);
        return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
      };
      const lum = (c: { r: number; g: number; b: number }) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const bgOf = (el: Element | null) => {
        for (let e = el; e; e = e.parentElement) {
          const c = rgb(getComputedStyle(e).backgroundColor);
          if (c && c.a > 0.5) return c;
        }
        return { r: 26, g: 28, b: 44, a: 1 };
      };
      const low: string[] = [];
      const small: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(sel as string)) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0);
        if (!own || !el.offsetWidth || !el.offsetHeight) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || el.closest('[aria-disabled="true"], :disabled, .visually-hidden, [hidden]')) continue;
        const fg = rgb(cs.color)!;
        const [hi, lo] = [lum(fg), lum(bgOf(el))].sort((a, b) => b - a);
        const ratio = (hi! + 0.05) / (lo! + 0.05);
        const label = `${el.id || el.className || el.tagName} «${(el.textContent ?? '').trim().slice(0, 12)}»`;
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) low.push(`${label} ${ratio.toFixed(2)}:1`);
        if (size < (min as number) - 0.05) small.push(`${label} ${size.toFixed(1)} px`);
      }
      return { low, small };
    },
    [scopes.map((s) => `${s}, ${s} *`).join(', '), minPx] as const,
  );
}

for (const text of [100, 200] as const) {
  test(`2.7: contraste de 4,5:1 y texto de 12 px o más en la barra, la franja y el dock (${text} %)`, async ({ page, request }, info) => {
    test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, request, text);
    // Al 200 %, nada por debajo de 18 px (el doble de 12 sería 24, pero la barra de arriba crece como mucho ×1,6).
    const a = await textAudit(page, ['.topbar', '.strip', '.dock', '.map-btns'], text === 100 ? 12 : 18);
    expect(a.low, 'texto con contraste de 4,5:1 o más').toEqual([]);
    expect(a.small, 'ningún texto demasiado pequeño').toEqual([]);
    // Al 200 % la franja y las cifras de la demanda crecen de verdad (antes ×1,3) y el dinero no pierde el «€».
    if (text === 200) {
      const sizes = await page.evaluate(() => ['#hud-date', '.d-row b', '.bar-num'].map((s) => parseFloat(getComputedStyle(document.querySelector(s)!).fontSize)));
      for (const s of sizes) expect(s).toBeGreaterThanOrEqual(22);
      await expect(page.locator('#hud-money')).toContainText('€');
    }
  });
}

test('2.7: el diálogo de confirmar atrapa el foco; h1 del pueblo y dock como barra de herramientas', async ({ page }, info) => {
  test.skip(info.project.name !== 'escritorio', 'basta con una vez');
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('.tut-box')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/);
  await expect(page.locator('#dock')).toHaveAttribute('role', 'toolbar');
  // Las flechas pasan de una pestaña a otra.
  await page.locator('#tab-inspect').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-road')).toBeFocused();
  await page.locator('.tut-skip').click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  await expect(dlg).toHaveAttribute('aria-describedby', 'dlg-d');
  expect(await page.locator('#game').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.modal')), 'el tabulador no sale del diálogo').toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(await page.locator('#game').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  await expect(page.locator('.tut-box')).toBeVisible();
});

for (const size of [SIZES[0]!, SIZES[2]!, SIZES[3]!]) {
  for (const text of [100, 200] as const) {
    test(`2.7: la leyenda de capas sale plegada en una línea y la cámara no se mueve (${size.name}, ${text} %)`, async ({ page, request }, info) => {
      test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
      test.setTimeout(120_000);
      await page.setViewportSize({ width: size.w, height: size.h });
      await open(page, request, text);
      const townhall = async () =>
        page.evaluate(() => {
          const w = window as unknown as { __bitopolis: { state: { buildings: { kind: string; x: number; y: number }[] }; tileCenter(x: number, y: number): { x: number; y: number } } };
          const th = w.__bitopolis.state.buildings.find((b) => b.kind === 'townhall')!;
          return w.__bitopolis.tileCenter(th.x, th.y);
        });
      for (const layer of ['Qué falta', 'Felicidad']) {
        const before = await townhall();
        await page.locator('#layers').click();
        await page.waitForTimeout(300);
        expect(await townhall(), 'al abrir «Capas» la cámara no se mueve').toEqual(before);
        await page.getByRole('radio', { name: layer }).click();
        await expect(page.locator('#legend')).toBeVisible();
        await page.waitForTimeout(300);
        expect(await townhall(), 'al elegir la capa la cámara no se mueve').toEqual(before);
        await page.evaluate(() => document.querySelectorAll('#toasts > *').forEach((t) => t.remove()));
        const map = (await page.locator('.map-wrap').boundingBox())!;
        const leg = (await page.locator('#legend').boundingBox())!;
        const name = `movil2-${size.name}-${text}-capa-${layer === 'Qué falta' ? 'falta' : 'felicidad'}`;
        await page.screenshot({ path: `test-results/capturas/${name}.png` });
        await expect(page.locator('#legend .legend-head')).toHaveAttribute('aria-expanded', 'false');
        expect(leg.height, 'plegada: una línea').toBeLessThanOrEqual(text === 100 ? 48 : 64);
        if (size.name === '360' && text === 100) expect((leg.width * leg.height) / (map.width * map.height), 'plegada tapa poco mapa').toBeLessThanOrEqual(0.15);
        expect(leg.x, 'abajo a la izquierda').toBeLessThan(map.x + 24);
        expect(leg.y + leg.height).toBeLessThanOrEqual(map.y + map.height + 1);
        // Desplegada: se ajusta al contenido y no pasa de la mitad del mapa.
        await page.locator('#legend .legend-head').click();
        await expect(page.locator('#legend .legend-head')).toHaveAttribute('aria-expanded', 'true');
        const opened = (await page.locator('#legend').boundingBox())!;
        expect(opened.height).toBeLessThanOrEqual(map.height * 0.5 + 1);
        const gap = await page.locator('#legend').evaluate((el) => el.clientHeight - [...el.children].reduce((a, c) => Math.max(a, (c as HTMLElement).offsetTop + (c as HTMLElement).offsetHeight), 0));
        expect(gap, 'sin hueco vacío').toBeLessThanOrEqual(16);
        await page.screenshot({ path: `test-results/capturas/${name}-abierta.png` });
        await page.locator('#legend .legend-head').click();
      }
    });
  }
}

for (const size of [SIZES[0]!, SIZES[2]!, SIZES[3]!]) {
  for (const text of [100, 200] as const) {
    test(`2.7: inicio con «Jugar» a la vista y el tamaño del texto (${size.name}, ${text} %)`, async ({ page }, info) => {
      test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.addInitScript((t) => localStorage.setItem('bitopolis.prefs', JSON.stringify({ text: t })), text);
      await page.goto('/');
      const play = page.getByRole('button', { name: 'Jugar' });
      await expect(play).toBeVisible();
      await expect(page.locator('#boot')).toBeHidden();
      await page.screenshot({ path: `test-results/capturas/movil2-${size.name}-${text}-inicio.png` });
      const r = (await play.boundingBox())!;
      expect(r.y + r.height, '«Jugar» se ve sin desplazar').toBeLessThanOrEqual(size.h + 1);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      // El tamaño del texto también se elige aquí.
      const group = page.getByRole('radiogroup', { name: 'Tamaño del texto' });
      await group.getByRole('radio', { name: text === 100 ? '200 %' : '100 %' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-text', text === 100 ? '200' : '100');
    });
  }
}

test('2.7: con la red lenta se ve «Cargando» desde el primer momento', async ({ page }, info) => {
  test.skip(info.project.name !== 'escritorio', 'basta con una vez');
  await page.route('**/assets/*.js', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#boot')).toBeVisible({ timeout: 1000 });
  await expect(page.locator('#boot')).toContainText('Cargando');
  await expect(page.getByRole('button', { name: 'Jugar' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#boot')).toBeHidden();
});

test('2.7: el tutorial va pegado a la franja, sin el amarillo de «?», y los pasos que informan llevan «Siguiente»', async ({ page }, info) => {
  test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  const box = page.locator('.tut-box');
  await expect(box).toContainText('Carretera');
  await page.waitForTimeout(300);
  const r = (await box.boundingBox())!;
  const strip = (await page.locator('#strip').boundingBox())!;
  expect(r.height, 'la caja es compacta').toBeLessThanOrEqual(80);
  expect(Math.abs(strip.y - (r.y + r.height)), 'pegada a la franja').toBeLessThanOrEqual(1);
  const bg = await box.evaluate((el) => getComputedStyle(el).backgroundColor);
  const help = await page.locator('#whatnow').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg, 'otro estilo que «?»').not.toBe(help);
  await expect(box.locator('.tut-next')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/capturas/movil2-360-100-tutorial.png' });
});

test('2.7: el paso del tutorial que solo informa se cierra con «Siguiente»', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
  await page.setViewportSize({ width: 360, height: 740 });
  // Un pueblo con agua, luz, casa y dos vecinos: el tutorial está en «¡Ya tienes vecinos!».
  const { state: s } = runSimulation({ seed: 7, days: 12, profile: 'constructor', checkEveryDay: false });
  const data = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: (s as GameState).formatVersion, exportedAt: '', mode: 'normal', state: s }));
  const { token } = await (await request.post('/api/import', { data, headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  const box = page.locator('.tut-box');
  await expect(box).toContainText('Ya tienes vecinos');
  await page.screenshot({ path: 'test-results/capturas/movil2-360-100-tutorial-siguiente.png' });
  await box.getByRole('button', { name: 'Siguiente' }).click();
  await expect(box).toBeHidden();
});
