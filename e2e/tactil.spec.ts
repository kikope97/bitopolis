import { expect, type Page, test } from '@playwright/test';
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
  await expect(page.locator('.sheet h2')).toHaveText('Ayuntamiento');
  await page.locator('.sheet-close').click();
  await setSpeed(page, 3);
  await page.locator('#menu').click();
  await expect(page.locator('.sheet h2')).toHaveText('Pueblo');
  await page.waitForTimeout(2500);
  await expect(page.locator('.sheet h2')).toHaveText('Pueblo');
  await page.getByRole('button', { name: 'Impuestos' }).click();
  await page.waitForTimeout(2000);
  await expect(page.locator('.sheet h2')).not.toHaveText('Ayuntamiento');
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
