import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, rankFor, runSimulation } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial } from './helpers.ts';

/** 2.1: de aldea a ciudad (cartel, escudo, fanfarria) y «Mientras no estabas». */
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

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

test('2.1: el pueblo sube de rango con fanfarria, cartel en la entrada y escudo en «Pueblo»', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-rangos-${n}.png` });
  // Un pueblo con gente y ayuntamiento de sobra, pero aún de aldea: sube al acabar el día.
  const { state } = runSimulation({ seed: 3, days: 500, profile: 'constructor' });
  expect(rankFor(state)).toBeGreaterThanOrEqual(1);
  state.rank = { ...state.rank!, level: 0, vote: null, crest: { ...state.rank!.crest, pieces: state.rank!.crest.pieces.slice(0, 1), motto: null } };
  const token = await importTown(request, state);
  await open(page, token);
  await setSpeed(page, 10);
  await expect.poll(() => page.evaluate(() => (window as any).__bitopolis.state.rank.level), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  // Baja sola a x1 (attention suave) y el cartel destella.
  await expect(page.locator('#speed')).toHaveText('x1');
  // El aviso queda en la campana.
  await expect.poll(() => page.evaluate(() => document.querySelector('#sr-live')?.textContent ?? '')).toContain('¡Bitópolis ya es lugar');
  const hook = await page.evaluate(() => {
    const b = (window as any).__bitopolis;
    return { rank: b.state.rank, highlight: b.highlight };
  });
  expect(hook.rank.level).toBe(1);
  expect(hook.rank.crest.pieces.length).toBe(2);
  expect(hook.rank.crest.motto).toBeTruthy();
  expect(hook.highlight).not.toBeNull();
  await setSpeed(page, 0);
  await page.evaluate(([x, y]) => (window as any).__bitopolis.centerOn(x, y), [hook.highlight.x, hook.highlight.y]);
  await shot('1-subida-y-cartel');

  // En «Pueblo», arriba del todo: el rango, el escudo y el lema; al tocarlo, la hoja.
  await page.locator('#menu').click();
  const card = page.locator('.rank-card');
  await expect(card).toContainText('Lugar');
  await expect(card.locator('canvas.crest')).toBeVisible();
  await shot('2-pueblo');
  await card.click();
  await expect(page.locator('#sheet-title')).toHaveText('Escudo y rango');
  await expect(page.locator('.sheet')).toContainText('Para Villa');
  await shot('3-escudo');
  expect(errors).toEqual([]);
});

for (const text of [100, 200] as const) {
  test(`2.1: «Mientras no estabas» al volver (texto ${text} %), se desliza y se pasa con botones`, async ({ page, request }, info) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const { state } = runSimulation({ seed: 42, days: 400, profile: 'constructor' });
    const token = await importTown(request, state);
    // La última visita fue hace 60 días de juego, con menos gente y menos caja.
    const seen = { tick: state.tick - 60 * 24, pop: state.citizens.length - 4, treasury: state.treasury - 2_000, at: 0, rank: 0 };
    await page.addInitScript(
      ([t, s, size]) => {
        localStorage.setItem(`bitopolis.seen.${t}`, s as string);
        localStorage.setItem('bitopolis.prefs', JSON.stringify({ text: size }));
      },
      [token, JSON.stringify(seen), text] as const,
    );
    await open(page, token);
    const away = page.locator('.away-sheet');
    await expect(away).toBeVisible();
    await expect(page.locator('#sheet-title')).toHaveText('Mientras no estabas');
    const slides = away.locator('.away-slide');
    const n = await slides.count();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(5);
    await expect(slides.first()).toContainText('+4 vecinos');
    await expect(away.locator('.away-status')).toHaveText(`1 de ${n}`);
    // Nada se sale de lado (legible a 390 px y al 200 %).
    const overflow = await page.evaluate(() => {
      const s = document.querySelector('.away-slide') as HTMLElement;
      return s.scrollWidth - s.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/capturas/${info.project.name}-rangos-4-mientras-${text}.png` });

    // Con el botón «Siguiente».
    await away.getByRole('button', { name: 'Momento siguiente' }).click();
    await expect(away.locator('.away-status')).toHaveText(`2 de ${n}`);
    // Deslizando (scroll con imán, como el dedo).
    await away.locator('.away-track').evaluate((el) => el.scrollTo({ left: el.clientWidth * 2, behavior: 'auto' }));
    await expect(away.locator('.away-status')).toHaveText(`3 de ${n}`);
    await page.screenshot({ path: `test-results/capturas/${info.project.name}-rangos-5-mientras-${text}-3.png` });
    // Hasta el final: «A jugar» cierra la tarjeta.
    for (let i = 3; i < n; i++) await away.getByRole('button', { name: 'Momento siguiente' }).click();
    await away.getByRole('button', { name: 'Cerrar y seguir jugando' }).click();
    await expect(away).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('2.1: sin ausencia no sale la tarjeta', async ({ page, request }) => {
  const { state } = runSimulation({ seed: 5, days: 60, profile: 'casual' });
  const token = await importTown(request, state);
  await open(page, token);
  await expect(page.locator('.away-sheet')).toHaveCount(0);
});
