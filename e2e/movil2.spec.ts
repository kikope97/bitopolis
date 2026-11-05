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
