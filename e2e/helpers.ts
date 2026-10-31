import type { Page } from '@playwright/test';

export interface Hook {
  state: any;
  tileCenter(x: number, y: number): { x: number; y: number };
}

export async function tile(page: Page, x: number, y: number) {
  return page.evaluate(([a, b]) => (window as unknown as { __bitopolis: Hook }).__bitopolis.tileCenter(a!, b!), [x, y]);
}

export async function state(page: Page) {
  return page.evaluate(() => (window as unknown as { __bitopolis: Hook }).__bitopolis.state);
}

/** Toca una casilla (también funciona con ratón). */
export async function tap(page: Page, x: number, y: number) {
  const p = await tile(page, x, y);
  await page.mouse.click(p.x, p.y);
}

export async function drag(page: Page, a: [number, number], b: [number, number]) {
  const p = await tile(page, ...a);
  const q = await tile(page, ...b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await page.mouse.move(q.x, q.y, { steps: 4 });
  await page.mouse.up();
}

/** Velocidad con el dock de la v1.4: ⏯ (#play) y el botón x1 → x3 → x10 (#speed). */
export async function setSpeed(page: Page, n: 0 | 1 | 3 | 10) {
  const paused = async () => (await page.locator('#play-pause').getAttribute('data-paused')) === 'true';
  if (n === 0) {
    if (!(await paused())) await page.locator('#play-pause').click();
    return;
  }
  for (let i = 0; i < 3 && (await page.locator('#speed').textContent()) !== `x${n}`; i++) await page.locator('#speed').click();
  if (await paused()) await page.locator('#play-pause').click();
}

/** Salta el tutorial si aparece (los pueblos importados ya no lo empiezan, ronda 11). */
export async function skipTutorial(page: Page) {
  const b = page.locator('.tut-box button');
  try {
    await b.waitFor({ state: 'visible', timeout: 1500 });
    await b.click();
  } catch {
    /* sin tutorial */
  }
}

/** v1.6: Mirar, Carretera y Derribar son pestañas; el resto, en la bandeja «Construir». */
export async function pickTool(page: Page, id: string) {
  if (['inspect', 'road', 'demolish'].includes(id)) return page.locator(`#tab-${id}`).click();
  if (await page.locator('#tray').isHidden()) await page.locator('#tab-build').click();
  await page.locator(`#tray [data-tool="${id}"]`).click();
}
