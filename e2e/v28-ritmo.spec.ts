import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { applyCommand, createInitialState, type GameState, runSimulation, validateCommand } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial } from './helpers.ts';

/**
 * 2.8 · A (ronda 24): el ritmo, los avisos y el tutorial.
 * - lo que te piden solo frena si vence pronto, y el aviso dice qué es y lleva allí («Ver ›»);
 * - lo ya visto (x10, «Siguiente» del tutorial) no se repite al volver;
 * - el tutorial usa el nombre que se ve en la pestaña y dónde está, y no pide x3 en modo tranquilo.
 * Capturas en test-results/capturas/v28-ritmo-*.
 */
const TICKS_PER_DAY = 24;

async function importTown(request: import('@playwright/test').APIRequestContext, s: GameState): Promise<string> {
  const data = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
  const { token } = await (await request.post('/api/import', { data, headers: { 'content-type': 'application/octet-stream' } })).json();
  return token as string;
}

let base: GameState | null = null;
/** Un pueblo con años, tranquilo (sin fuego, sol, «Pueblo sencillo») y una subvención que vence en `days` días. */
function town(days: number): GameState {
  if (!base) base = runSimulation({ seed: 42, days: 400, profile: 'constructor', checkEveryDay: false }).state;
  const s = structuredClone(base);
  for (const b of s.buildings) {
    delete b.fire;
    delete b.risk;
  }
  s.simple = true;
  if (s.errands) s.errands.list = [];
  s.weather = { kind: 'sol', until: s.tick + 30 * TICKS_PER_DAY };
  s.grants.push({ id: s.nextId++, kind: 'library', share: 0.5, offeredTick: s.tick, deadline: s.tick + 200 * TICKS_PER_DAY, status: 'offered', advance: 0, minId: s.nextId, offerDays: days });
  return s;
}

async function enter(page: Page, token: string) {
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

const tick = (page: Page) => page.evaluate(() => (window as any).__bitopolis.state.tick as number);

test('2.8: lo que vence pronto baja a x1 diciendo qué es, y «Ver ›» lleva allí', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const token = await importTown(request, town(3));
  await enter(page, token);
  await setSpeed(page, 10);
  const note = page.locator('#slow-note');
  await expect(note).toBeVisible({ timeout: 30_000 });
  await expect(note).toContainText(/Bajo a x1: La Diputación paga el 50 % de .+ \((quedan 2 días|queda 1 día|vence hoy)\)/);
  await expect(page.locator('#speed')).toHaveText('x1');
  await page.screenshot({ path: `test-results/capturas/v28-ritmo-${info.project.name}-bajo-a-x1.png` });
  const go = page.locator('#slow-go');
  await expect(go).toBeVisible();
  const box = (await go.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await go.click();
  await expect(page.locator('#th-grants')).toBeVisible();
  await expect(note).toBeHidden();
  expect(errors).toEqual([]);
});

test('2.8: lo que vence en semanas no frena x10', async ({ page, request }) => {
  test.setTimeout(90_000);
  const token = await importTown(request, town(25));
  await enter(page, token);
  const t0 = await tick(page);
  await setSpeed(page, 10);
  // 8 s a x10 ≈ 4 días de juego: la subvención (25 días) no baja a x1.
  await page.waitForTimeout(8_000);
  expect(await tick(page)).toBeGreaterThan(t0 + 2 * TICKS_PER_DAY);
  const note = page.locator('#slow-note');
  if (await note.isVisible()) await expect(note).not.toContainText('Diputación');
});

test('2.8: el aviso de x10 sale una vez por partida (también al volver)', async ({ page, request }) => {
  test.setTimeout(90_000);
  const token = await importTown(request, town(25));
  await enter(page, token);
  await setSpeed(page, 10);
  await expect(page.locator('#toasts')).toContainText('x10 avanza un mes cada minuto');
  // Dice la verdad: baja a x1 con las emergencias y lo que vence pronto.
  await expect(page.locator('#toasts')).toContainText('lo que vence en pocos días');
  await setSpeed(page, 0);
  await page.reload();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 10);
  await page.waitForTimeout(800);
  await expect(page.locator('#toasts')).not.toContainText('x10 avanza');
  await setSpeed(page, 0);
});

test('2.8: el tutorial dice el nombre de la pestaña que se ve y dónde está', async ({ page }, info) => {
  test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
  // En vertical, al 100 %: «Carretera», abajo; con ratón, «haz clic».
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  const box = page.locator('.tut-box');
  await expect(box).toContainText('Haz clic en «Carretera», abajo.');
  // En horizontal, al 200 %: la pestaña pone «Calle» y el riel está a la derecha.
  await page.evaluate(() => localStorage.setItem('bitopolis.prefs', JSON.stringify({ text: 200 })));
  await page.setViewportSize({ width: 740, height: 360 });
  await page.reload();
  await page.getByRole('button', { name: /Jugar|Continuar/ }).click();
  await expect(box).toContainText('Carretera');
  await expect(box).toContainText('«Calle», a la derecha.');
  await expect(page.locator('#tab-road .tl-short')).toBeVisible();
  await page.screenshot({ path: 'test-results/capturas/v28-ritmo-tutorial-horizontal-200.png' });
});

test('2.8: el «Siguiente» del tutorial se recuerda al volver a la partida', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'escritorio', 'basta con una vez');
  const { state: s } = runSimulation({ seed: 7, days: 12, profile: 'constructor', checkEveryDay: false });
  const token = await importTown(request, s);
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  const box = page.locator('.tut-box');
  await expect(box).toContainText('Ya tienes vecinos');
  await box.getByRole('button', { name: 'Siguiente' }).click();
  await expect(box).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(box).toBeHidden();
});

function spot(s: GameState, kind: 'house' | 'water' | 'power', not: { x: number; y: number }[] = []) {
  const th = s.buildings.find((b) => b.kind === 'townhall')!;
  for (let r = 1; r < 9; r++) {
    for (let y = th.y - r; y <= th.y + r; y++) {
      for (let x = th.x - r; x <= th.x + r; x++) {
        if (not.some((p) => p.x === x && p.y === y)) continue;
        if (validateCommand(s, { type: 'Build', kind, x, y }).ok) return { x, y };
      }
    }
  }
  throw new Error('sin sitio');
}

test('2.8: en modo tranquilo el tutorial no pide x3', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'escritorio', 'basta con una vez');
  const s = createInitialState({ seed: 7 });
  const taken: { x: number; y: number }[] = [];
  for (const kind of ['water', 'power', 'house'] as const) {
    const at = spot(s, kind, taken);
    taken.push(at);
    expect(applyCommand(s, { type: 'Build', kind, ...at }).ok).toBe(true);
  }
  const token = await importTown(request, s);
  await page.addInitScript(() => localStorage.setItem('bitopolis.prefs', JSON.stringify({ calm: true })));
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  const box = page.locator('.tut-box');
  await expect(box).toContainText('▶');
  await expect(box).toContainText('modo tranquilo');
  await expect(box).not.toContainText('x3');
});
