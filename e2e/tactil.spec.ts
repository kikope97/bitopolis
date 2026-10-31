import { expect, type Page, test } from '@playwright/test';
import { state, tile } from './helpers.ts';

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
  await page.locator('.tut-box button').click();
}

test('táctil: tocar enseña la obra y solo se construye al confirmar, en la casilla tocada', async ({ page }, info) => {
  await start(page);
  const t = await touch(page);
  const s0 = await state(page);
  const th = s0.buildings.find((b: { kind: string }) => b.kind === 'townhall');
  const target = { x: th.x + 1, y: th.y + 2 };
  await page.locator('[data-tool="house"]').click();
  // La ayuda de la herramienta cambia de alto: el toque tiene que seguir cayendo donde se ve.
  const p = await tile(page, target.x, target.y);
  await t.tap(p.x, p.y);
  await expect(page.locator('#confirm-bar')).toBeVisible();
  expect((await state(page)).buildings.length).toBe(s0.buildings.length);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v14-confirmar.png` });
  await page.locator('#confirm-yes').click();
  await expect(page.locator('#confirm-bar')).toBeHidden();
  await expect.poll(async () => (await state(page)).buildings.some((b: { x: number; y: number; kind: string }) => b.kind === 'house' && b.x === target.x && b.y === target.y)).toBe(true);
});

test('táctil: con un edificio elegido, arrastrar mueve el mapa y no construye nada', async ({ page }) => {
  await start(page);
  const t = await touch(page);
  const n0 = (await state(page)).buildings.length;
  await page.locator('[data-tool="water"]').click();
  const box = (await page.locator('#map').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let i = 0; i < 4; i++) await t.drag({ x: cx, y: cy }, { x: cx - 120, y: cy - 90 });
  await page.waitForTimeout(300);
  expect((await state(page)).buildings.length).toBe(n0);
  await expect(page.locator('#confirm-bar')).toBeHidden();
  // ✕ cancela una obra propuesta.
  await page.locator('[data-tool="house"]').click();
  await t.tap(cx, cy);
  await expect(page.locator('#confirm-bar')).toBeVisible();
  await page.locator('#confirm-no').click();
  await expect(page.locator('#confirm-bar')).toBeHidden();
  expect((await state(page)).buildings.length).toBe(n0);
});

test('táctil: carretera arrastrando se enseña y se confirma', async ({ page }) => {
  await start(page);
  const t = await touch(page);
  const s0 = await state(page);
  const th = s0.buildings.find((b: { kind: string }) => b.kind === 'townhall');
  await page.locator('[data-tool="road"]').click();
  const a = await tile(page, th.x - 2, th.y + 3);
  const b = await tile(page, th.x + 2, th.y + 3);
  await t.drag(a, b);
  await expect(page.locator('#confirm-bar')).toBeVisible();
  await expect(page.locator('#confirm-text')).toContainText('5 casillas');
  await page.locator('#confirm-yes').click();
  await expect.poll(async () => (await state(page)).map.tiles[(th.y + 3) * s0.map.w + th.x]).toBe(1);
});

test('el menú ☰ no se cambia solo por la última ficha mirada (el «menú en bucle»)', async ({ page }) => {
  await start(page);
  const s0 = await state(page);
  const th = s0.buildings.find((b: { kind: string }) => b.kind === 'townhall');
  await page.locator('[data-tool="inspect"]').click();
  const p = await tile(page, th.x, th.y);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.sheet h2')).toHaveText('Ayuntamiento');
  await page.locator('.sheet-close').click();
  await page.locator('[data-speed="3"]').click();
  await page.locator('#menu').click();
  await expect(page.locator('.sheet h2')).toHaveText('Menú');
  await page.waitForTimeout(2500);
  await expect(page.locator('.sheet h2')).toHaveText('Menú');
  await page.getByRole('button', { name: 'Impuestos' }).click();
  await page.waitForTimeout(2000);
  await expect(page.locator('.sheet h2')).not.toHaveText('Ayuntamiento');
});
