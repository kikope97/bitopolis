import { expect, test } from '@playwright/test';

/** v1.3: interfaz (skyline animado, icono de píxeles, atajo de Ajustes, enlace). */
test('v1.3: skyline que se mueve, llave de píxeles, tecla O y nota del enlace', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Jugar' })).toBeVisible();
  const sky = () => page.evaluate(() => (document.querySelector('#skyline') as HTMLCanvasElement).toDataURL());
  const a = await sky();
  await page.waitForTimeout(700);
  expect(await sky()).not.toBe(a);
  // La llave es un icono pintado con la paleta, no un emoji.
  const keyPixels = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[data-icon="key"]')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  });
  expect(keyPixels).toBeGreaterThan(10);
  await expect(page.locator('summary')).not.toContainText('🔑');
  // Sin URL pública distinta, no hace falta la nota.
  await expect(page.locator('#link-note')).toBeHidden();

  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await page.locator('.tut-box button').click();
  await page.locator('#map').focus();
  await page.keyboard.press('o');
  await expect(page.locator('.sheet h2')).toHaveText('Ajustes');
  expect(errors).toEqual([]);
});

test('v1.3: con movimiento reducido, el skyline no se mueve', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Jugar' })).toBeVisible();
  const sky = () => page.evaluate(() => (document.querySelector('#skyline') as HTMLCanvasElement).toDataURL());
  const a = await sky();
  await page.waitForTimeout(700);
  expect(await sky()).toBe(a);
  await ctx.close();
});
