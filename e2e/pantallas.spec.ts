import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { pickTool, setSpeed, skipTutorial } from './helpers.ts';
import { runSimulation } from '../packages/sim/src/index.ts';

/**
 * Ronda de pantallas (2.5.1): la barra de arriba, la lista de vecinos, la leyenda de «Qué falta»,
 * la franja de abajo y la flecha del tutorial, medidas en seis pantallas con texto al 100 y al 200 %.
 * Solo corre en el proyecto «escritorio»: cada bloque pone su propia pantalla (táctil o no).
 */
test.describe.configure({ mode: 'parallel' });

let cached: Buffer | null = null;
function town(): Buffer {
  if (cached) return cached;
  // Para repetir la prueba deprisa en local: PW_TOWN_CACHE=ruta guarda el pueblo ya simulado.
  const file = process.env.PW_TOWN_CACHE;
  if (file && existsSync(file)) return (cached = readFileSync(file));
  // Pueblo crecido, a 10 días de votar (como e2e/elecciones-listas.spec.ts).
  const { state } = runSimulation({ seed: 4, days: 1430, profile: 'agresivo' });
  cached = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
  if (file) writeFileSync(file, cached);
  return cached;
}

const DEVICES = [
  { name: '360', viewport: { width: 360, height: 740 }, touch: true, dpr: 2 },
  { name: '390', viewport: { width: 390, height: 844 }, touch: true, dpr: 3 },
  { name: '412', viewport: { width: 412, height: 915 }, touch: true, dpr: 2 },
  { name: '768', viewport: { width: 768, height: 1024 }, touch: true, dpr: 2 },
  { name: '1280', viewport: { width: 1280, height: 800 }, touch: false, dpr: 1 },
  { name: '1920', viewport: { width: 1920, height: 1080 }, touch: false, dpr: 1 },
] as const;

type Box = { x: number; y: number; width: number; height: number };
const rect = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().toJSON() as Box);
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext) {
  const r = await request.post('/api/import', { data: town(), headers: { 'content-type': 'application/octet-stream' } });
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
  // Sin avisos encima de lo que se mide.
  await page.evaluate(() => document.querySelectorAll('#toasts > *').forEach((t) => t.remove()));
}

for (const d of DEVICES) {
  for (const text of [100, 200] as const) {
    test.describe(`${d.name} px · texto ${text} %`, () => {
      test.use({ viewport: d.viewport, hasTouch: d.touch, isMobile: d.touch && d.viewport.width < 700, deviceScaleFactor: d.dpr });
      test.beforeEach(async ({ page }, info) => {
        test.skip(info.project.name !== 'escritorio', 'cada bloque pone su pantalla');
        await page.addInitScript((t) => localStorage.setItem('bitopolis.prefs', JSON.stringify({ text: t })), text);
      });
      const shot = (page: Page, n: string) => page.screenshot({ path: `test-results/capturas/pantallas-${d.name}-${text}-${n}.png` });

      test('pueblo crecido: barra, franja, vecinos, «Qué falta» y consejo', async ({ page, request }) => {
        test.setTimeout(120_000);
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await openTown(page, request);
        await expect(page.locator('#hud-poll')).toBeVisible();
        await shot(page, '1-pantalla');
        if (d.viewport.width >= 1600) {
          // Pantalla grande: la barra y la franja con letra mayor (petición del creador).
          const fs = await page.locator('.topbar').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
          expect.soft(fs, 'letra de la barra en 1920 px').toBeGreaterThanOrEqual(18);
        }

        // --- barra de arriba: nada se sale, cada dato con su icono y separado del siguiente ---
        const bar = await page.locator('.topbar').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        expect.soft(bar.sw, 'la barra no se desborda').toBeLessThanOrEqual(bar.cw + 1);
        const ids = ['#play-pause', '#speed', '#hud-money', '#hud-pop', '#hud-happy', '#hud-poll', '#bell'];
        const boxes: Box[] = [];
        for (const id of ids) {
          const b = await rect(page, id);
          boxes.push(b);
          expect.soft(b.height, `${id} se toca bien (alto)`).toBeGreaterThanOrEqual(44);
          expect.soft(b.width, `${id} se toca bien (ancho)`).toBeGreaterThanOrEqual(44);
          expect.soft(b.x + b.width, `${id} cabe en la pantalla`).toBeLessThanOrEqual(d.viewport.width + 1);
        }
        for (const id of ['#hud-money', '#hud-pop', '#hud-happy']) {
          const icon = await page.locator(`${id} .px-icon`).evaluate((el) => (el as HTMLElement).offsetWidth);
          expect.soft(icon, `${id} conserva su icono`).toBeGreaterThan(0);
        }
        // El contenido de cada dato (texto, flecha) no pisa el del siguiente: al menos 4 px de hueco.
        const inner = await page.evaluate((sel) => sel.map((s) => {
          const el = document.querySelector(s)!;
          const kids = [...el.children, ...[...el.childNodes].filter((n) => n.nodeType === 3)].map((k) => {
            if (k.nodeType === 3) { const r = document.createRange(); r.selectNodeContents(k); return r.getBoundingClientRect(); }
            return (k as HTMLElement).getBoundingClientRect();
          }).filter((r) => r.width > 0);
          return { left: Math.min(...kids.map((r) => r.left)), right: Math.max(...kids.map((r) => r.right)), mid: (kids[0]!.top + kids[0]!.bottom) / 2 };
        }), ['#hud-money', '#hud-pop', '#hud-happy', '#hud-poll']);
        // Solo entre datos de la misma fila (con texto grande en el móvil, la barra va en dos filas).
        for (let i = 1; i < inner.length; i++) if (Math.abs(inner[i]!.mid - inner[i - 1]!.mid) < 10) expect.soft(inner[i]!.left - inner[i - 1]!.right, `hueco entre los datos ${i - 1} y ${i}`).toBeGreaterThanOrEqual(4);

        // --- franja de abajo: la fecha a la vista y entera ---
        const date = await page.locator('#hud-date').evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, sw: el.scrollWidth, text: el.textContent }));
        expect.soft(date.w, 'la fecha se ve en la franja').toBeGreaterThan(0);
        expect.soft(date.sw, 'la fecha no se corta').toBeLessThanOrEqual(date.w + 1);
        const strip = await page.locator('#strip-info').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        expect.soft(strip.sw, 'la franja no se desborda').toBeLessThanOrEqual(strip.cw + 1);

        // --- lista de vecinos: el detalle va a lo ancho, no en una columna estrecha ---
        await page.locator('#hud-pop').click();
        const row = page.locator('.people .person-row').first();
        await expect(row).toBeVisible();
        await shot(page, '2-vecinos');
        const rows = await page.locator('.people .person-row').evaluateAll((els) => els.slice(0, 8).map((el) => {
          const sub = el.querySelector('.p-sub') as HTMLElement | null;
          return { rem: parseFloat(getComputedStyle(document.documentElement).fontSize), h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width, sub: sub ? sub.getBoundingClientRect().width : 0 };
        }));
        for (const r of rows) {
          if (r.sub) expect.soft(r.sub, 'el detalle ocupa casi toda la fila').toBeGreaterThan(r.w * 0.6);
          // Como mucho unas cuatro líneas de texto (al 200 % la letra base es de 32 px).
          expect.soft(r.h, 'fila compacta').toBeLessThanOrEqual(r.rem * 5.5);
        }
        const sheetOverflow = await page.locator('.sheet').evaluate((el) => el.scrollWidth - el.clientWidth);
        expect.soft(sheetOverflow, 'la hoja no se sale por el lado').toBeLessThanOrEqual(1);
        await page.locator('.sheet-close').first().click();

        // --- capa «Qué falta»: la leyenda queda dentro del mapa, sin tapar la barra ---
        await page.locator('#layers').click();
        await page.locator('.sheet .btn.choice', { hasText: 'Qué falta' }).click();
        await expect(page.locator('#legend')).toBeVisible();
        await page.evaluate(() => document.querySelectorAll('#toasts > *').forEach((t) => t.remove()));
        await shot(page, '3-que-falta');
        const map = await rect(page, '.map-wrap');
        const top = await rect(page, '.topbar');
        let leg = await rect(page, '#legend');
        expect.soft(leg.y, 'la leyenda no sube por encima del mapa').toBeGreaterThanOrEqual(map.y - 1);
        expect.soft(overlap(leg, top), 'la leyenda no tapa la barra de arriba').toBe(0);
        expect.soft(leg.y + leg.height, 'la leyenda no baja de la franja').toBeLessThanOrEqual(map.y + map.height + 1);
        if (d.viewport.width < 700) expect.soft(leg.height, 'en el móvil, plegada, deja ver el mapa').toBeLessThanOrEqual(map.height * 0.4);
        // Se despliega con un toque y sigue dentro (se desplaza si no cabe).
        await page.locator('.legend-head').click();
        await shot(page, '4-que-falta-abierta');
        leg = await rect(page, '#legend');
        expect.soft(leg.y, 'abierta, sigue dentro del mapa').toBeGreaterThanOrEqual(map.y - 1);
        expect.soft(leg.y + leg.height, 'abierta, no baja de la franja').toBeLessThanOrEqual(map.y + map.height + 1);
        await page.locator('#layers').click();
        await page.locator('.sheet .btn.choice', { hasText: 'Sin capa' }).click();

        // --- consejo de «?»: si no cabe en la franja, se lee entero al tocarlo ---
        await page.locator('#whatnow').click();
        const info = page.locator('#tool-info');
        await expect(info).toContainText('¿Qué hago?');
        await shot(page, '5-consejo');
        await info.click();
        await page.waitForTimeout(200);
        const full = await page.evaluate(() => {
          const el = document.querySelector('#tool-info') as HTMLElement;
          const visible = el.offsetWidth > 0 && el.scrollHeight <= el.clientHeight + 1;
          const sheet = document.querySelector('.sheet:not([hidden])');
          return visible || !!sheet?.textContent?.includes(el.textContent!.replace('¿Qué hago? ', '').slice(0, 40));
        });
        expect.soft(full, 'el consejo se puede leer entero').toBe(true);
        await shot(page, '6-consejo-entero');
        if (await page.locator('.sheet-close').count()) await page.locator('.sheet-close').first().click();

        // --- con una herramienta de trazado, «Capas» y «?» no estorban en el mapa ---
        await pickTool(page, 'road');
        const chipVisible = await page.locator('#layers').isVisible();
        if (d.touch) expect.soft(chipVisible, 'trazando con el dedo, «Capas» se aparta').toBe(false);
        await shot(page, '7-carretera');
        await pickTool(page, 'inspect');
        await expect(page.locator('#layers')).toBeVisible();
        expect(errors).toEqual([]);
      });

      test('tutorial: la flecha no pisa la franja ni los títulos de la bandeja', async ({ page }) => {
        test.skip(text === 200 && d.viewport.width >= 700, 'basta con el 100 % en pantallas grandes');
        await page.goto('/');
        await page.getByRole('button', { name: 'Jugar' }).click();
        await expect(page.locator('.tut-box')).toContainText('Carretera', { timeout: 15_000 });
        await page.waitForTimeout(300);
        const strip = await rect(page, '#strip');
        const arrowOnStrip = async () => {
          const a = page.locator('.tut-arrow:not([hidden])');
          if (!(await a.count()) || !(await a.isVisible())) return 0;
          return overlap(await rect(page, '.tut-arrow'), strip);
        };
        expect.soft(await arrowOnStrip(), 'paso 1: la flecha no tapa la franja').toBe(0);
        await shot(page, '8-tutorial');
        // Paso del agua: con la bandeja abierta, la flecha no tapa el título de la categoría.
        await pickTool(page, 'road');
        const s = await page.evaluate(() => (window as unknown as { __bitopolis: { state: { map: { w: number; h: number } } } }).__bitopolis.state);
        const cx = Math.floor(s.map.w / 2);
        const cy = Math.floor(s.map.h / 2);
        const c = (x: number, y: number) => page.evaluate(([a, b]) => (window as unknown as { __bitopolis: { tileCenter(x: number, y: number): { x: number; y: number } } }).__bitopolis.tileCenter(a!, b!), [x, y]);
        const p = await c(cx + 3, cy);
        const q = await c(cx + 3, cy + 3);
        // Con ratón también en las pantallas táctiles (el trazado con el dedo ya lo mide tactil.spec.ts).
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
        await page.mouse.move(q.x, q.y, { steps: 4 });
        await page.mouse.up();
        if (await page.locator('#confirm-yes').isVisible()) await page.locator('#confirm-yes').click();
        await expect(page.locator('.tut-box')).toContainText('agua');
        expect.soft(await arrowOnStrip(), 'paso del agua: la flecha no tapa la franja').toBe(0);
        await shot(page, '9-tutorial-agua');
        await page.locator('#tab-build').click();
        await expect(page.locator('#tray')).toBeVisible();
        await page.waitForTimeout(300);
        const heads = await page.locator('#tray h3').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
        const a = page.locator('.tut-arrow');
        const arrows: Box[] = [];
        if ((await a.count()) && (await a.isVisible())) arrows.push(await rect(page, '.tut-arrow'));
        // La marca dibujada en el propio botón (si la hay).
        const mark = await page.evaluate(() => {
          const t = document.querySelector('.tut-target');
          if (!t) return null;
          const r = t.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: 1 };
        });
        if (mark) arrows.push(mark);
        for (const ar of arrows) for (const hd of heads) expect.soft(overlap(ar, hd as Box), 'la flecha no tapa el título de la bandeja').toBe(0);
        await shot(page, '10-tutorial-bandeja');
      });
    });
  }
}

test('de noche el pueblo se ve (1280 px)', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'escritorio');
  test.setTimeout(120_000);
  const raw = JSON.parse(gunzipSync(town()).toString());
  // A medianoche (el día empieza a las 8:00): solo para dibujar, no se juega.
  raw.state.tick += 16;
  const r = await request.post('/api/import', { data: gzipSync(JSON.stringify(raw)), headers: { 'content-type': 'application/octet-stream' } });
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/capturas/pantallas-noche.png' });
  // Brillo medio del mapa: no un pozo negro.
  const lum = await page.evaluate(() => {
    const c = document.querySelector('#map') as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 16) s += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    return s / (d.length / 16);
  });
  expect.soft(lum, 'brillo medio de noche').toBeGreaterThan(40);
});
