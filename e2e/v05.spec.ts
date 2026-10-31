import { expect, test } from '@playwright/test';
import { pickTool, state, tap, skipTutorial } from './helpers.ts';

test('v0.5: ajustes de accesibilidad, teclado y carretera con dos toques', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v05-${n}.png` });
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await skipTutorial(page);
  const s0 = await state(page);
  const cx = Math.floor(s0.map.w / 2);
  const cy = Math.floor(s0.map.h / 2);

  // Carretera: toque de inicio y toque de fin (sin arrastrar).
  await pickTool(page, 'road');
  await tap(page, cx + 3, cy);
  await expect(page.locator('#tool-info')).toContainText('toca dónde termina');
  await tap(page, cx + 3, cy + 3);
  await expect(page.locator('#tool-info')).toContainText('Toca otra vez el final para confirmar');
  await tap(page, cx + 3, cy + 3);
  await expect.poll(async () => (await state(page)).map.tiles.filter((t: number) => t === 1).length).toBeGreaterThan(s0.map.tiles.filter((t: number) => t === 1).length + 2);

  // Teclado: el mapa enfocado con un cursor de casilla que se anuncia.
  await pickTool(page, 'inspect');
  await page.locator('#map').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#sr-live')).toContainText('Casilla');

  // Ajustes: radiogroup con flechas, texto al 200 %, alto contraste y modo tranquilo.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Ajustes/ }).click();
  const size = page.getByRole('radiogroup', { name: 'Tamaño del texto' });
  await size.getByRole('radio', { name: '100 %' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(size.getByRole('radio', { name: '200 %' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-text', '200');
  await page.getByRole('radiogroup', { name: 'Contraste' }).getByRole('radio', { name: 'Alto' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'alto');
  await page.getByLabel(/Modo tranquilo/).check();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reducido');
  // Trampa de foco: Tab no sale de la hoja.
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('.sheet') ? 'dentro' : document.activeElement?.outerHTML.slice(0, 120))).toBe('dentro');
  await shot('ajustes');
  await page.keyboard.press('Escape');
  // Modo tranquilo: x10 se queda en x1.
  await expect(page.locator('#speed')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#speed').click({ force: true });
  await expect(page.locator('#speed')).toHaveText('x1');
  await expect(page.locator('#play-pause')).toHaveAttribute('data-paused', 'false');
  await shot('texto-200');
  // Las preferencias se recuerdan al recargar.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-text', '200');
  expect(errors).toEqual([]);
});
