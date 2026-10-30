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
