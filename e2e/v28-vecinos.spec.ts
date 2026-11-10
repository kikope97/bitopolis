import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { CARE, type GameState, PROFESSION_AGE, professionStale, runSimulation } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial, tile } from './helpers.ts';

/** 2.8 (ronda 24, parte E): fichas que no mienten y vecinos con un oficio que cuadra con su edad. */
function pack(state: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, state: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(state), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

async function inspect(page: Page, x: number, y: number) {
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);
  const p = await tile(page, x, y);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.sheet')).toBeVisible();
}

test('2.8: la riada dice «riada», la salud bloqueada no sale «Cubierto» y los oficios cuadran con la edad', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v28-vecinos-${n}.png` });
  const { state } = runSimulation({ seed: 3, days: 500, profile: 'constructor' });
  // Ningún vecino con nombre tiene un oficio que no cuadre con su edad.
  for (const c of state.citizens.filter((x) => x.named)) expect(professionStale(c.profession, c.age, { ...PROFESSION_AGE, pensionAge: CARE.pensionAge }), `${c.name} ${c.age}`).toBe(false);
  // Sin centro de salud y con el ayuntamiento por debajo del nivel que lo desbloquea.
  state.buildings = state.buildings.filter((b) => b.kind !== 'clinic');
  for (const c of state.citizens) if (c.jobId !== null && !state.buildings.some((b) => b.id === c.jobId)) c.jobId = null;
  state.townhallLevel = 2;
  const houses = state.buildings.filter((b) => b.kind === 'house' && b.built && !b.damaged);
  expect(houses.length).toBeGreaterThanOrEqual(2);
  const flooded = houses[0]!;
  flooded.damaged = { cost: 2_000, repairUntil: -1, cause: 'riada' };
  const house = houses[1]!;
  expect(state.citizens.length).toBeGreaterThanOrEqual(25);
  await openTown(page, request, state);
  await setSpeed(page, 0);

  // Casa destrozada por la riada: no dice «disturbios».
  await inspect(page, flooded.x, flooded.y);
  const dmg = page.locator('.sheet [data-test="damaged-cause"]');
  await expect(dmg).toHaveAttribute('data-cause', 'riada');
  await expect(dmg).toContainText('Destrozado por la riada');
  await expect(dmg).not.toContainText('disturbios');
  await shot('riada');
  await page.keyboard.press('Escape');

  // Casa normal: la salud sale bloqueada, no «Cubierto».
  await inspect(page, house.x, house.y);
  const salud = page.locator('.sheet .svc-table .svc', { hasText: 'Salud' });
  await expect(salud).toHaveClass(/lock/);
  await expect(salud).toContainText('🔒');
  await expect(salud).not.toContainText('Cubierto');
  await shot('salud');
  expect(errors).toEqual([]);
});
