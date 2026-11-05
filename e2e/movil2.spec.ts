import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, levelOf, maxLevelOf, OUTSIDE, runSimulation, transfer, TREASURY, UPGRADABLE } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial, tile } from './helpers.ts';

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

/**
 * 2.7 «Pueblo 2.0» y fichas: el mismo pueblo, con la caja casi vacía y un mes en
 * negativo (para que haya algo en «Lo urgente») y un servicio que se puede ampliar.
 */
let hubTown: { buf: Buffer; service: { x: number; y: number; kind: string } } | null = null;
function hubPack() {
  if (!hubTown) {
    const { state: s } = runSimulation({ seed: 4, days: 1200, profile: 'constructor', checkEveryDay: false });
    for (const b of s.buildings) {
      delete b.fire;
      delete b.risk;
    }
    if (s.treasury > 400) transfer(s, TREASURY, OUTSIDE, s.treasury - 400, 'mantenimiento');
    const last = s.stats.at(-1)!;
    last.expenses = last.income + 2_000;
    const svc = s.buildings.find((b) => b.built && !b.damaged && UPGRADABLE.includes(b.kind) && levelOf(b) < maxLevelOf(b) && b.kind !== 'townhall')!;
    hubTown = {
      buf: gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: (s as GameState).formatVersion, exportedAt: '', mode: 'normal', state: s })),
      service: { x: svc.x, y: svc.y, kind: svc.kind },
    };
  }
  return hubTown;
}

for (const size of SIZES.slice(0, 2)) {
  test(`2.7: panel «Pueblo» y ficha de un servicio a ${size.name}`, async ({ page, request }, info) => {
    test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: size.w, height: size.h });
    const town = hubPack();
    const { token } = await (await request.post('/api/import', { data: town.buf, headers: { 'content-type': 'application/octet-stream' } })).json();
    // Tres entradas con «Nuevo»: como mucho se marcan dos a la vez.
    await page.addInitScript((t) => {
      if (localStorage.getItem(`bitopolis.reveal.${t}`)) return;
      localStorage.setItem(`bitopolis.reveal.${t}`, JSON.stringify({ known: ['hub:diary', 'hub:album', 'hub:history'], fresh: ['hub:diary', 'hub:album', 'hub:history'] }));
    }, token);
    await page.goto(`/p/${token}`);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await skipTutorial(page);
    await setSpeed(page, 0);
    for (let i = 0; i < 3 && (await page.locator('.sheet-close').first().isVisible()); i++) await page.locator('.sheet-close').first().click();

    await page.locator('#menu').click();
    await expect(page.locator('#sheet-title')).toHaveText('Pueblo');
    // Cuatro tarjetas de resumen en 2×2, a la vista sin desplazar.
    const stats = page.locator('.sheet .hub-stat');
    await expect(stats).toHaveCount(4);
    const boxes = await stats.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, b: r.bottom })));
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y), 'dos por fila').toBeLessThan(2);
    expect(boxes[2]!.y, 'la segunda fila, debajo').toBeGreaterThan(boxes[0]!.y + 20);
    expect(boxes[3]!.b, 'las cuatro se ven sin desplazar').toBeLessThanOrEqual(size.h);
    await expect(stats.first()).toContainText('Dinero');
    // «Lo urgente»: la caja aguanta poco → «Ver cuentas».
    const urgent = page.locator('.sheet .hub-urgent');
    await expect(urgent).toBeVisible();
    const cards = urgent.locator('.hu-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
    expect(await cards.count()).toBeLessThanOrEqual(3);
    await expect(urgent.getByRole('button', { name: 'Ver cuentas' })).toBeVisible();
    // La lista: filas de 48 px o más, con su icono; lo frecuente a la vista.
    const rows = await page.locator('.sheet .hub-row').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r) => r >= 48), `filas: ${rows.join(', ')}`).toBe(true);
    await expect(page.getByRole('button', { name: 'Impuestos' })).toBeVisible();
    // «Nuevo»: como mucho dos, y en una sola línea.
    const badges = await page.locator('.sheet .new-badge').evaluateAll((els) => els.map((e) => ({ h: e.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(e).fontSize), lh: parseFloat(getComputedStyle(e).lineHeight) || 0 })));
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(badges.length).toBeLessThanOrEqual(2);
    for (const b of badges) expect(b.h, '«Nuevo» no se parte').toBeLessThan(Math.max(b.lh, b.fs * 1.6) + 2);
    expect(await page.locator('.sheet').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/capturas/movil2-${size.name}-pueblo.png` });
    await page.locator('.sheet-body').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.screenshot({ path: `test-results/capturas/movil2-${size.name}-pueblo-abajo.png` });
    // Lo frecuente, a dos toques: «Pueblo» › «Impuestos».
    await page.getByRole('button', { name: 'Impuestos' }).click();
    await expect(page.locator('#sheet-title')).not.toHaveText('Pueblo');
    await page.locator('.sheet-close').click();

    // Ficha de un servicio: estado (número y palabra) y botón principal sin desplazar.
    await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [town.service.x, town.service.y]);
    const p = await tile(page, town.service.x, town.service.y);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.sheet')).toBeVisible();
    const status = page.locator('.sheet [data-test="fiche-status"]');
    const main = page.locator('.sheet [data-test="fiche-main"]');
    await expect(status).toBeVisible();
    await expect(status).toHaveText(/\S/);
    await expect(main).toBeVisible();
    await expect(main).toContainText('Ampliar a nivel');
    const view = await page.locator('.sheet-body').evaluate((el) => ({ top: el.scrollTop, bottom: el.getBoundingClientRect().bottom }));
    expect(view.top).toBe(0);
    for (const el of [status, main]) {
      const r = (await el.boundingBox())!;
      expect(r.y + r.height, 'a la vista sin desplazar').toBeLessThanOrEqual(view.bottom + 1);
      expect(r.y + r.height).toBeLessThanOrEqual(size.h);
    }
    expect((await main.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `test-results/capturas/movil2-${size.name}-ficha-servicio.png` });
    await page.locator('.sheet-close').click();

    // Ficha de un vecino: retrato y frase arriba, el ánimo con palabra y número, «Hablar».
    await page.locator('#menu').click();
    await page.getByRole('button', { name: 'Vecinos', exact: true }).click();
    await page.locator('.person-row').first().click();
    await expect(page.locator('.sheet .cz-head .cz-face')).toBeVisible();
    await expect(page.locator('.sheet .cz-head [data-test="fiche-status"]')).toHaveText(/(Contento|Regular|Descontento).*\d+ de 100/);
    const talk = page.getByRole('button', { name: '¿Cómo estás?' });
    await expect(talk).toBeVisible();
    expect((await talk.boundingBox())!.y + 44).toBeLessThanOrEqual(size.h);
    await page.screenshot({ path: `test-results/capturas/movil2-${size.name}-ficha-vecino.png` });
    expect(errors).toEqual([]);
  });
}
