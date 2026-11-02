import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, OUTSIDE, runSimulation, transfer, TREASURY, validateCommand } from '../packages/sim/src/index.ts';
import { chooseOffer, openTrayCat, pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/** 2.6 «Lo básico»: el panel «Pueblo» y la bandeja crecen con el pueblo; licitaciones solo en obras grandes; «Pueblo sencillo». */

function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, s: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(s), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await skipTutorial(page);
  await setSpeed(page, 0);
}

/** 390 px táctil en «movil»; 1280 en «escritorio». */
async function viewport(page: Page, project: string) {
  if (project === 'movil') await page.setViewportSize({ width: 390, height: 844 });
}

const hubButton = (page: Page, name: string | RegExp) => page.locator('.sheet .hub-grid').getByRole('button', { name });

test('2.6: una partida nueva enseña solo lo básico en «Pueblo» y en «Construir»', async ({ page }, info) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await viewport(page, info.project.name);
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await skipTutorial(page);
  await setSpeed(page, 0);

  await page.locator('#menu').click();
  await expect(page.locator('#sheet-title')).toHaveText('Pueblo');
  for (const name of ['Parte mensual', 'Impuestos', 'Vecinos', 'Felicidad', 'Ajustes']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  for (const name of [/^Préstamos/, 'Pleno municipal', 'Política y elecciones', /Comarca y grandes obras/, /Pueblos vecinos/, 'Encargos del pueblo', 'El Eco de Bitópolis', /^Medallas/, 'Historia', 'Consejero', 'Álbum del pueblo']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.locator('.rank-card')).toHaveCount(0);
  await expect(page.locator('.new-badge')).toHaveCount(0);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-progresivo-1-pueblo.png` });
  await page.locator('.sheet-close').click();

  // La bandeja: lo lejano (grandes obras, turismo, transporte…) ni se ve; lo del nivel 2, plegado.
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray')).toBeVisible();
  for (const cat of ['Grandes obras', 'Turismo', 'Transporte', 'Cuidados', 'Premios de los hitos']) await expect(page.locator(`#tray details[data-cat="${cat}"]`)).toBeHidden();
  await expect(page.locator('#tray details[data-cat="Lo básico"]')).toBeVisible();
  await expect(page.locator('#tray details[data-cat="Zonas (los vecinos construyen)"]')).toBeVisible();
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-progresivo-2-bandeja.png` });
  // El ayudante de las pruebas sigue llegando a lo oculto (para leer su candado).
  await openTrayCat(page, 'heritage');
  await page.locator('#tray [data-tool="heritage"]').click({ force: true });
  await expect(page.locator('.tray-msg')).toContainText('nivel 3');
  expect(errors).toEqual([]);
});

test('2.6: al ampliar el ayuntamiento, lo que aparece lleva «Nuevo» hasta que se abre', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  await viewport(page, info.project.name);
  const { state: s } = runSimulation({ seed: 3, days: 300, profile: 'casual' });
  expect(s.townhallLevel).toBe(2);
  expect(s.citizens.length).toBeGreaterThanOrEqual(30);
  expect(s.citizens.length).toBeLessThan(60);
  // Sin ofertas de los pueblos vecinos (con una pendiente, «Pueblos vecinos» ya saldría con el nivel 2).
  s.comarca.offers = [];
  await openTown(page, request, s);

  // Primera vez en este navegador: lo que ya usaba, sin «Nuevo».
  await page.locator('#menu').click();
  await expect(hubButton(page, /^Vecinos$/)).toBeVisible();
  await expect(page.locator('.new-badge')).toHaveCount(0);
  await expect(hubButton(page, /Pueblos vecinos/)).toHaveCount(0);
  await page.locator('.sheet-close').click();
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray details[data-cat="Grandes obras"]')).toBeHidden();
  await page.locator('#tab-build').click();

  // Ampliar a nivel 3 (desde el panel «Pueblo» › Ayuntamiento).
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /^Nivel 2 · Ampliar/ }).click();
  await page.getByRole('button', { name: /Ampliar a nivel 3/ }).click();
  await expect.poll(async () => (await state(page)).townhallLevel).toBe(3);
  await page.locator('.sheet-close').click();
  await expect(page.locator('#menu')).toHaveClass(/has-new/);
  await page.locator('#menu').click();
  const vecinos = hubButton(page, /Pueblos vecinos/);
  await expect(vecinos).toBeVisible();
  await expect(vecinos).toHaveClass(/is-new/);
  await expect(vecinos.locator('.new-badge')).toHaveText('Nuevo');
  // El nombre del botón no cambia («Nuevo» va como descripción).
  await expect(page.getByRole('button', { name: 'Pueblos vecinos', exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-progresivo-3-nuevo.png` });
  await vecinos.click();
  await expect(page.locator('.sheet h2')).toContainText('Pueblos vecinos');
  await page.locator('.sheet-close').click();
  await page.locator('#menu').click();
  await expect(hubButton(page, /Pueblos vecinos/)).not.toHaveClass(/is-new/);
  await page.locator('.sheet-close').click();

  // La bandeja: «Grandes obras» ya se alcanza con el nivel 4, y sale con «Nuevo».
  await expect(page.locator('#tab-build')).toHaveClass(/has-new/);
  await page.locator('#tab-build').click();
  const big = page.locator('#tray details[data-cat="Grandes obras"]');
  await expect(big).toBeVisible();
  await expect(big.locator('.new-badge')).toHaveText('Nuevo');
  await big.locator('[data-tool="bridge"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-progresivo-4-bandeja-nuevo.png` });
  await big.locator('summary').click();
  await expect(big.locator('.new-badge')).toHaveCount(0);

  // Y tras recargar se recuerda (preferencia del navegador).
  await page.reload();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await page.locator('#menu').click();
  await expect(hubButton(page, /Pueblos vecinos/)).not.toHaveClass(/is-new/);
});

test('2.6: con el ayuntamiento 3, el colegio va sin licitación', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  await viewport(page, info.project.name);
  const { state: s } = runSimulation({ seed: 3, days: 400, profile: 'casual', checkEveryDay: false });
  s.townhallLevel = Math.max(3, s.townhallLevel);
  // Ronda 22: con el gasto corriente, a los 400 días la caja no llega para un colegio.
  transfer(s, OUTSIDE, TREASURY, 20_000, 'subvencion');
  for (const b of s.buildings) {
    delete b.fire;
    delete b.risk;
  }
  let spot: { x: number; y: number } | null = null;
  for (let y = 2; y < s.map.h - 2 && !spot; y++) for (let x = 2; x < s.map.w - 2 && !spot; x++) if (validateCommand(s, { type: 'Build', kind: 'school', x, y }).ok && s.map.terrain[y * s.map.w + x] === 0) spot = { x, y };
  expect(spot).toBeTruthy();
  await openTown(page, request, s);
  const before = (await state(page)).projects.length;
  await pickTool(page, 'school');
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [spot!.x, spot!.y]);
  const p = await tile(page, spot!.x, spot!.y);
  await page.mouse.click(p.x, p.y);
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) {
    await page.waitForTimeout(400);
    await yes.click();
  }
  await expect(page.locator('.tender-card')).toHaveCount(0);
  await expect.poll(async () => (await state(page)).projects.length, { timeout: 10_000 }).toBe(before + 1);
  // Por si acaso: si saliera la hoja, la prueba ya habría fallado arriba.
  await chooseOffer(page);
  expect((await state(page)).tenders ?? []).toEqual([]);
});

test('2.6: «Pueblo sencillo» en Configurar: sin encargos, El Eco, pueblos vecinos, licitaciones ni dilemas', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await viewport(page, info.project.name);
  await page.goto('/');
  await page.locator('#configure').click();
  const box = page.getByRole('checkbox', { name: /Pueblo sencillo/ });
  await expect(box).not.toBeChecked();
  await expect(page.locator('.sheet')).toContainText('Sin encargos, El Eco, pueblos vecinos, licitaciones ni dilemas');
  await box.check();
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-progresivo-5-configurar.png` });
  await page.locator('.sheet-close').click();
  await expect(page.locator('#simple-note')).toBeVisible();
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await expect.poll(async () => (await state(page)).simple).toBe(true);

  // Un pueblo sencillo con años: el panel no enseña lo apagado (y sí la comarca con sus grandes obras).
  const { state: s } = runSimulation({ seed: 3, days: 500, profile: 'casual', simple: true });
  s.townhallLevel = Math.max(3, s.townhallLevel);
  expect(s.errands?.list ?? []).toEqual([]);
  expect(s.comarca.towns).toEqual([]);
  await openTown(page, request, s);
  await page.locator('#menu').click();
  await expect(hubButton(page, /Comarca y grandes obras/)).toBeVisible();
  for (const name of [/Pueblos vecinos/, 'Encargos del pueblo', 'El Eco de Bitópolis', 'Un asunto difícil']) await expect(page.getByRole('button', { name })).toHaveCount(0);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-progresivo-6-sencillo.png` });
  expect(errors).toEqual([]);
});
