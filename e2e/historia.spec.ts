import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { ACHIEVEMENT_LIST, type GameState, runSimulation } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial } from './helpers.ts';

/** 2.3: «Historia» (gráfica por meses y años, récords) y la rejilla de medallas, a 360 px. */
function pack(state: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

async function importTown(request: import('@playwright/test').APIRequestContext, state: GameState): Promise<string> {
  const { token } = await (await request.post('/api/import', { data: pack(state), headers: { 'content-type': 'application/octet-stream' } })).json();
  return token as string;
}

async function open(page: Page, token: string) {
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

/** Píxeles de la gráfica que no son el fondo (hay línea dibujada). */
const inked = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('canvas.history-chart') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== 0x1a || d[i + 1] !== 0x1c || d[i + 2] !== 0x2c) n++;
    return n;
  });

const overflow = (page: Page) =>
  page.evaluate(() => {
    const s = document.querySelector('.sheet-body') as HTMLElement;
    return s.scrollWidth - s.clientWidth;
  });

let town: GameState;
test.beforeAll(() => {
  // Un pueblo de algo más de 3 años: 3 años cerrados en la historia y unas cuantas medallas.
  town = runSimulation({ seed: 42, days: 30 * 40, profile: 'casual' }).state;
});

for (const text of [100, 200] as const) {
  test(`2.3: historia y medallas a 360 px (texto ${text} %)`, async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-historia-${text}-${n}.png` });
    await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript((size) => localStorage.setItem('bitopolis.prefs', JSON.stringify({ text: size })), text);
    expect(town.history.length).toBeGreaterThanOrEqual(4);
    expect(town.medals.length).toBeGreaterThanOrEqual(3);
    const token = await importTown(request, town);
    await open(page, token);
    await setSpeed(page, 0);

    // Pueblo › Gente › Historia.
    await page.locator('#menu').click();
    await page.getByRole('button', { name: 'Historia', exact: true }).click();
    await expect(page.locator('#sheet-title')).toHaveText('Historia');
    await expect(page.locator('.sheet-back')).toBeVisible();
    const chart = page.locator('canvas.history-chart');
    await expect(chart).toHaveAttribute('aria-label', /^Vecinos, 12 meses: de \d+ vecinos a \d+ vecinos/);
    expect(await inked(page)).toBeGreaterThan(200);
    const box = (await chart.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(328);
    expect(box.width).toBeGreaterThan(280);

    // Un dedo sobre la gráfica enseña el valor de ese mes.
    await chart.click({ position: { x: box.width - 4, y: box.height / 2 } });
    await expect(page.locator('.history-readout')).toHaveText(/A4: \d+ vecinos$/);
    await shot('1-vecinos');

    // Otra serie y otro rango: la caja en todos los años (media con mínimo y máximo).
    await page.getByRole('radio', { name: 'Caja' }).click();
    await expect(chart).toHaveAttribute('aria-label', /^Caja, 12 meses/);
    await page.getByRole('radio', { name: 'Todo' }).click();
    await expect(page.getByRole('radio', { name: 'Todo' })).toHaveAttribute('aria-checked', 'true');
    await expect(chart).toHaveAttribute('aria-label', /^Caja, todo \(media de cada año\)/);
    await expect(page.locator('.history-note')).toContainText('Un punto por año');
    expect(await inked(page)).toBeGreaterThan(200);
    await chart.click({ position: { x: 6, y: box.height / 2 } });
    await expect(page.locator('.history-readout')).toHaveText(/^Año 1: .*€/);
    await page.getByRole('radio', { name: '5 años' }).click();
    await expect(chart).toHaveAttribute('aria-label', /^Caja, 5 años/);

    // Récords debajo.
    const records = page.locator('.history-record');
    expect(await records.count()).toBeGreaterThanOrEqual(4);
    await expect(records.first()).toContainText('Más vecinos');
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await records.first().scrollIntoViewIfNeeded();
    await shot('2-caja-y-records');

    // ‹ vuelve a «Pueblo»; Objetivos › Medallas.
    await page.locator('.sheet-back').click();
    await expect(page.locator('#sheet-title')).toHaveText('Pueblo');
    const medalsBtn = page.getByRole('button', { name: new RegExp(`^Medallas · ${town.medals.length} de ${ACHIEVEMENT_LIST.length}$`) });
    await medalsBtn.scrollIntoViewIfNeeded();
    await medalsBtn.click();
    await expect(page.locator('#sheet-title')).toHaveText('Medallas');
    const cells = page.locator('.medal-cell');
    await expect(cells).toHaveCount(ACHIEVEMENT_LIST.length);
    await expect(page.locator('.medal-cell.got')).toHaveCount(town.medals.length);
    // Rejilla de 4 columnas de 72 px.
    const pos = await cells.evaluateAll((els) => els.slice(0, 5).map((e) => e.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), w: Math.round(r.width) })));
    expect(new Set(pos.slice(0, 4).map((p) => p.top)).size).toBe(1);
    expect(pos[4]!.top).toBeGreaterThan(pos[0]!.top);
    expect(pos[0]!.w).toBe(72);
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // Al tocar una conseguida: su texto y la fecha. Una que falta: la pista.
    await page.locator('.medal-cell.got').first().click();
    await expect(page.locator('.medal-detail')).toContainText('Conseguida el');
    await page.locator('.medal-cell.missing').first().click();
    await expect(page.locator('.medal-detail')).toContainText('Aún no la tienes');
    await shot('3-medallas');
    expect(errors).toEqual([]);
  });
}
