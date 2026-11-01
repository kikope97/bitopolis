import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { dilemmaCandidates, openDilemma, OUTSIDE, runSimulation, transfer, TREASURY } from '../packages/sim/src/index.ts';
import { pickTool, state, tile, setSpeed, skipTutorial } from './helpers.ts';

/**
 * v1.4: juego con el dedo de verdad (eventos táctiles por CDP, no ratón).
 * Lo que se rompía: obras que caían casillas más arriba, edificios que se
 * colocaban al arrastrar el mapa y obras sin querer.
 */
test.skip(({ browserName }) => browserName !== 'chromium');

async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] } as never);
  return {
    tap: async (x: number, y: number) => {
      await send('touchStart', x, y);
      await send('touchEnd', x, y);
    },
    drag: async (a: { x: number; y: number }, b: { x: number; y: number }) => {
      await send('touchStart', a.x, a.y);
      for (let i = 1; i <= 8; i++) await send('touchMove', a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
      await send('touchEnd', b.x, b.y);
    },
  };
}

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await skipTutorial(page);
}

test('táctil: tocar enseña la obra y solo se construye al confirmar, en la casilla tocada', async ({ page }, info) => {
  await start(page);
  const t = await touch(page);
  const s0 = await state(page);
  const th = s0.buildings.find((b: { kind: string }) => b.kind === 'townhall');
  const target = { x: th.x + 1, y: th.y + 2 };
  await pickTool(page, 'house');
  // La ayuda de la herramienta cambia de alto: el toque tiene que seguir cayendo donde se ve.
  const p = await tile(page, target.x, target.y);
  await t.tap(p.x, p.y);
  await expect(page.locator('#confirm-bar')).toBeVisible();
  expect((await state(page)).buildings.length).toBe(s0.buildings.length);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v14-confirmar.png` });
  await page.waitForTimeout(400); // la barra ignora toques en sus primeros 350 ms
  await page.locator('#confirm-yes').click();
  await expect(page.locator('#confirm-bar')).toBeHidden();
  await expect.poll(async () => (await state(page)).buildings.some((b: { x: number; y: number; kind: string }) => b.kind === 'house' && b.x === target.x && b.y === target.y)).toBe(true);
});

test('táctil: con un edificio elegido, arrastrar mueve el mapa y no construye nada', async ({ page }) => {
  await start(page);
  const t = await touch(page);
  const n0 = (await state(page)).buildings.length;
  await pickTool(page, 'water');
  const box = (await page.locator('#map').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let i = 0; i < 4; i++) await t.drag({ x: cx, y: cy }, { x: cx - 120, y: cy - 90 });
  await page.waitForTimeout(300);
  expect((await state(page)).buildings.length).toBe(n0);
  await expect(page.locator('#confirm-bar')).toBeHidden();
  // ✕ cancela una obra propuesta.
  await pickTool(page, 'house');
  await t.tap(cx, cy);
  await expect(page.locator('#confirm-bar')).toBeVisible();
  await page.waitForTimeout(400); // la barra ignora toques en sus primeros 350 ms
  await page.locator('#confirm-no').click();
  await expect(page.locator('#confirm-bar')).toBeHidden();
  expect((await state(page)).buildings.length).toBe(n0);
});

test('táctil: carretera con dos toques (un dedo arrastrando mueve el mapa) se enseña y se confirma', async ({ page }) => {
  await start(page);
  const t = await touch(page);
  const s0 = await state(page);
  const th = s0.buildings.find((b: { kind: string }) => b.kind === 'townhall');
  await pickTool(page, 'road');
  const a = await tile(page, th.x - 2, th.y + 3);
  // Arrastrar sin inicio marcado mueve el mapa, no traza.
  await t.drag({ x: a.x, y: a.y }, { x: a.x - 60, y: a.y });
  await expect(page.locator('#confirm-bar')).toBeHidden();
  const a2 = await tile(page, th.x - 2, th.y + 3);
  const b2 = await tile(page, th.x + 2, th.y + 3);
  await t.tap(a2.x, a2.y);
  await t.tap(b2.x, b2.y);
  await expect(page.locator('#confirm-bar')).toBeVisible();
  await expect(page.locator('#confirm-text')).toContainText('5 casillas');
  await page.waitForTimeout(400); // la barra ignora toques en sus primeros 350 ms
  await page.locator('#confirm-yes').click();
  await expect.poll(async () => (await state(page)).map.tiles[(th.y + 3) * s0.map.w + th.x]).toBe(1);
});

test('el menú ☰ no se cambia solo por la última ficha mirada (el «menú en bucle»)', async ({ page }) => {
  await start(page);
  const s0 = await state(page);
  const th = s0.buildings.find((b: { kind: string }) => b.kind === 'townhall');
  await pickTool(page, 'inspect');
  const p = await tile(page, th.x, th.y);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.sheet h2')).toHaveText('Gestión del pueblo');
  await page.locator('.sheet-close').click();
  await setSpeed(page, 3);
  await page.locator('#menu').click();
  await expect(page.locator('.sheet h2')).toHaveText('Pueblo');
  await page.waitForTimeout(2500);
  await expect(page.locator('.sheet h2')).toHaveText('Pueblo');
  await page.getByRole('button', { name: 'Impuestos' }).click();
  await page.waitForTimeout(2000);
  await expect(page.locator('.sheet h2')).not.toHaveText('Gestión del pueblo');
});

test('táctil: un solo toque junto al borde de abajo no construye (el clic fantasma caía en «Construir»)', async ({ page }) => {
  await start(page);
  const t = await touch(page);
  const s0 = await state(page);
  const th = s0.buildings.find((b: { kind: string }) => b.kind === 'townhall');
  const target = { x: th.x + 1, y: th.y + 2 };
  const box = (await page.locator('#map').boundingBox())!;
  // Mover el mapa despacio (sin inercia) hasta que la casilla quede a ~35 px del borde inferior.
  for (let i = 0; i < 6; i++) {
    const p = await tile(page, target.x, target.y);
    const dy = box.y + box.height - 35 - p.y;
    if (Math.abs(dy) < 6) break;
    const step = Math.max(-200, Math.min(200, dy));
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] } as never);
    for (let k = 1; k <= 20; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy + (step * k) / 20 }] } as never);
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] } as never);
    await page.waitForTimeout(150);
  }
  await pickTool(page, 'house');
  const p = await tile(page, target.x, target.y);
  const n0 = (await state(page)).buildings.length;
  await t.tap(p.x, p.y);
  await page.waitForTimeout(600);
  expect((await state(page)).buildings.length).toBe(n0);
  await expect(page.locator('#confirm-bar')).toBeVisible();
});

test('táctil: con el inicio de una carretera marcado, la barra dice qué hacer y ✕ lo cancela', async ({ page }) => {
  await start(page);
  const t = await touch(page);
  const th = (await state(page)).buildings.find((b: { kind: string }) => b.kind === 'townhall');
  await pickTool(page, 'road');
  const a = await tile(page, th.x - 2, th.y + 3);
  await t.tap(a.x, a.y);
  await expect(page.locator('#confirm-text')).toContainText('Toca dónde termina');
  await expect(page.locator('#confirm-yes')).toBeHidden();
  await page.waitForTimeout(400); // la barra ignora toques en sus primeros 350 ms
  await page.locator('#confirm-no').click();
  await expect(page.locator('#confirm-bar')).toBeHidden();
});

test('táctil: se puede alejar como antes; muy alejado, el primer toque acerca y no construye (v1.6.1)', async ({ page }, info) => {
  // Con densidad ×1 (escritorio) la casilla mínima ya es de 32 px: no hay nada que alejar.
  test.skip(info.project.name !== 'movil');
  await start(page);
  const t = await touch(page);
  const width = async () => (await tile(page, 1, 0)).x - (await tile(page, 0, 0)).x;
  const w0 = await width();
  await page.locator('#map').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('-');
  const w1 = await width();
  expect(w1).toBeLessThan(w0);
  expect(w1).toBeLessThan(24);
  const s0 = await state(page);
  const th = s0.buildings.find((b: { kind: string }) => b.kind === 'townhall');
  await pickTool(page, 'house');
  const p = await tile(page, th.x + 1, th.y + 2);
  await t.tap(p.x, p.y);
  // Primer toque: acerca (casillas de 24 px o más) y no propone obra.
  await expect.poll(width).toBeGreaterThanOrEqual(24);
  await expect(page.locator('#confirm-bar')).toBeHidden();
  // Segundo toque: ya propone la obra.
  const q = await tile(page, th.x + 1, th.y + 2);
  await t.tap(q.x, q.y);
  await expect(page.locator('#confirm-bar')).toBeVisible();
});

test('táctil: el dilema se abre y se resuelve con el dedo (2.4)', async ({ page, request }, info) => {
  // Solo con pantalla táctil: en escritorio Chrome no convierte el toque en clic sobre los botones.
  test.skip(info.project.name !== 'movil');
  test.setTimeout(120_000);
  // Pueblo con un preso arrepentido y su familia (como en ia-pleno.spec.ts).
  const { state: s } = runSimulation({ seed: 1, days: 420, profile: 'constructor' });
  transfer(s, OUTSIDE, TREASURY, 20_000, 'subvencion');
  s.townhallLevel = Math.max(2, s.townhallLevel ?? 1);
  const [p, k] = s.citizens.filter((c) => c.named && c.homeId !== null);
  k!.homeId = p!.homeId;
  s.justice!.jail.push({ until: s.tick + 40 * 24, citizenId: p!.id });
  openDilemma(s, dilemmaCandidates(s).find((c) => c.kind === 'preso_arrepentido')!.key);
  const data = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
  const { token } = await (await request.post('/api/import', { data, headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
  const t = await touch(page);
  const tapOn = async (loc: import('@playwright/test').Locator) => {
    await loc.scrollIntoViewIfNeeded();
    const b = (await loc.boundingBox())!;
    await t.tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  await tapOn(page.locator('#menu'));
  await tapOn(page.getByRole('button', { name: /Un asunto difícil/ }));
  await expect(page.locator('.sheet h2')).toContainText('preso arrepentido');
  const opt = page.getByRole('button', { name: /Pedir el indulto/ });
  const box = (await opt.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(280);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-vida-dilema-tactil-360.png` });
  await tapOn(opt);
  await expect(page.locator('.sheet')).toContainText('Decidiste: Pedir el indulto');
  expect((await state(page)).dilemmas.at(-1).resolved).toBe('pedir_indulto');
});
