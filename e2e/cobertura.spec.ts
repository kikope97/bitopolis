import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type BuildingKind, coverageOf, type GameState, newBuilding, OUTSIDE, runSimulation, transfer, TREASURY, validateCommand } from '../packages/sim/src/index.ts';
import { pickTool, setSpeed, skipTutorial, tile } from './helpers.ts';

/**
 * 2.6 «Lo básico» (queja de un jugador): al tocar un servicio se ve la zona
 * que cubre, a cuántas casas da servicio y su máximo; al colocarlo, lo que
 * ganaría; y «Qué falta» se filtra por un servicio.
 */
const DEVICES = [
  { name: '360', viewport: { width: 360, height: 740 }, touch: true, dpr: 3 },
  { name: '390', viewport: { width: 390, height: 844 }, touch: true, dpr: 3 },
  { name: '1280', viewport: { width: 1280, height: 800 }, touch: false, dpr: 1 },
];

/** Un pueblo sin colegio, salud, policía ni bomberos (el agresivo no los hace) y se los ponemos, menos la policía. */
let cached: { s: GameState; school: { x: number; y: number }; police: { x: number; y: number }; packed: Buffer } | null = null;
function town() {
  if (cached) return cached;
  const { state: s } = runSimulation({ seed: 4, days: 420, profile: 'agresivo' });
  s.townhallLevel = Math.max(3, s.townhallLevel);
  transfer(s, OUTSIDE, TREASURY, 80_000, 'subvencion');
  const homes = s.buildings.filter((b) => (b.kind === 'house' || b.kind === 'res') && b.built);
  const cx = Math.round(homes.reduce((a, b) => a + b.x, 0) / homes.length);
  const cy = Math.round(homes.reduce((a, b) => a + b.y, 0) / homes.length);
  const spotNear = (kind: BuildingKind, x0: number, y0: number) => {
    let best: { x: number; y: number; d: number } | null = null;
    for (let y = 1; y < s.map.h - 1; y++)
      for (let x = 1; x < s.map.w - 1; x++) {
        const d = Math.abs(x - x0) + Math.abs(y - y0);
        if ((!best || d < best.d) && validateCommand(s, { type: 'Build', kind: kind as never, x, y }).ok) best = { x, y, d };
      }
    return best!;
  };
  const place = (kind: BuildingKind, x0: number, y0: number) => {
    const p = spotNear(kind, x0, y0);
    const b = newBuilding(s, kind, p.x, p.y, TREASURY);
    b.built = true;
    return p;
  };
  const school = place('school', cx, cy);
  place('clinic', cx + 2, cy - 2);
  place('firestation', cx - 3, cy + 1);
  // La comisaría la pone el jugador: el mejor sitio, el que más casas gana.
  let police = { x: 0, y: 0, gains: -1 };
  for (let y = 1; y < s.map.h - 1; y++)
    for (let x = 1; x < s.map.w - 1; x++) {
      if (Math.abs(x - cx) + Math.abs(y - cy) > 10 || !validateCommand(s, { type: 'Build', kind: 'police', x, y }).ok) continue;
      const g = coverageOf(s, 'police', x, y).gains.length;
      if (g > police.gains) police = { x, y, gains: g };
    }
  const packed = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
  cached = { s, school, police, packed };
  return cached;
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext) {
  const { packed } = town();
  const { token } = await (await request.post('/api/import', { data: packed, headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
  await page.evaluate(() => document.querySelectorAll('#toasts > *').forEach((t) => t.remove()));
}

const hook = async (page: Page) => {
  // 2.8: el dibujo puede ir a 30 fps (al alejar en escritorio); se espera al primer fotograma con la zona.
  await expect.poll(() => page.evaluate(() => (window as any).__bitopolis.reach !== null && (window as any).__bitopolis.reach !== undefined)).toBe(true);
  return page.evaluate(() => (window as any).__bitopolis.reach);
};

for (const d of DEVICES) {
  test.describe(`cobertura ${d.name} px`, () => {
    test.use({ viewport: d.viewport, hasTouch: d.touch, isMobile: d.touch, deviceScaleFactor: d.dpr });
    test.beforeEach(async ({ page: _page }, info) => {
      test.skip(info.project.name !== 'escritorio', 'cada bloque pone su pantalla');
    });
    const shot = (page: Page, n: string) => page.screenshot({ path: `test-results/capturas/cobertura-${d.name}-${n}.png` });
    /** Toca (con el dedo en táctil) una casilla, centrándola antes. */
    const touchTile = async (page: Page, x: number, y: number) => {
      await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);
      const p = await tile(page, x, y);
      if (d.touch) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    };

    test('al tocar el colegio: su zona, a cuántas casas da servicio y su máximo; «Ver zona»', async ({ page, request }) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openTown(page, request);
      const { school } = town();
      await touchTile(page, school.x, school.y);
      const line = page.locator('.sheet [data-test="reach-line"]');
      await expect(line).toContainText(/\d+ viviendas? · \d+ de 60 alumnos/);
      const r = await hook(page);
      expect(r, 'se dibuja la zona').toBeTruthy();
      expect(r.tiles).toBeGreaterThan(100);
      expect(r.borders).toBeGreaterThanOrEqual(1);
      expect(r.ok, 'casas cubiertas con ✓').toBeGreaterThan(0);
      // La zona queda a la vista, por encima de la hoja (o al lado del panel).
      expect(await page.evaluate(([x, y]) => (window as any).__bitopolis.visible(x, y), [school.x, school.y]), 'el colegio se ve').toBe(true);
      await shot(page, '1-colegio');
      await page.locator('.sheet [data-test="see-zone"]').click();
      await expect(page.locator('.sheet')).toHaveCount(0);
      expect((await hook(page))?.tiles).toBe(r.tiles);
      await shot(page, '2-ver-zona');
      expect(errors).toEqual([]);
    });

    test('al colocar la comisaría: el rombo, las casas que ganan y el texto de la barra', async ({ page, request }) => {
      test.setTimeout(120_000);
      await openTown(page, request);
      const { police } = town();
      await pickTool(page, 'police');
      await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [police.x, police.y]);
      const p = await tile(page, police.x, police.y);
      if (d.touch) {
        // En táctil, el toque enseña la obra y la barra «Construir / ✕» con lo que gana.
        await page.touchscreen.tap(p.x, p.y);
        await expect(page.locator('#confirm-bar')).toBeVisible();
        await expect(page.locator('[data-test="cc-reach"]')).toContainText(/\+\d+ casas? con policía(?: \(y \d+ solar(?:es)?\))? · atenderá a ~\d+ de 120/);
      } else {
        await page.mouse.move(p.x, p.y);
        await expect(page.locator('[data-test="reach-hint"]')).toContainText(/\+\d+ casas? con policía(?: \(y \d+ solar(?:es)?\))? · atenderá a ~\d+ de 120/);
      }
      const r = await hook(page);
      expect(r.plus, 'casas que ganan (+)').toBeGreaterThan(0);
      expect(r.borders).toBeGreaterThanOrEqual(1);
      await shot(page, '3-colocar');
    });

    test('«Qué falta» filtrable: un servicio, sus casas y su zona; «Construir» deja el filtro', async ({ page, request }) => {
      test.setTimeout(120_000);
      await openTown(page, request);
      await page.locator('#layers').click();
      await expect(page.locator('.sheet .btn.choice', { hasText: 'Cobertura de servicios' })).toHaveCount(0);
      await page.locator('.sheet .btn.choice', { hasText: 'Qué falta' }).click();
      // Desplegada, para ver todas las filas.
      if ((await page.locator('.legend-head').getAttribute('aria-expanded')) === 'false') await page.locator('.legend-head').click();
      const row = page.locator('#legend .legend-pick[data-need="policia"]');
      await expect(row).toHaveAttribute('aria-pressed', 'false');
      const box = await row.boundingBox();
      expect(box!.height, 'fila de 44 px').toBeGreaterThanOrEqual(43.5);
      await row.click();
      const filter = page.locator('[data-test="legend-filter"]');
      await expect(filter).toContainText(/Policía · falta en \d+ casas?/);
      await expect(page.locator('#legend .legend-pick[aria-pressed="true"]')).toHaveCount(1);
      const r = await hook(page);
      expect(r.veil, 'velo fuera de la zona').toBe(true);
      await shot(page, '4-filtro-policia');
      await filter.locator('.legend-go').click();
      await expect(page.locator('#tab-build')).toHaveAttribute('aria-pressed', 'true');
      await expect(filter).toBeVisible();
      await shot(page, '5-filtro-construir');
      await page.locator('[data-test="legend-off"]').click();
      await expect(filter).toHaveCount(0);
    });
  });
}
