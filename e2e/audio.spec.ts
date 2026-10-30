import { expect, test } from '@playwright/test';

test('audio: volúmenes en dB, ambiente y mute separados se guardan y no dan errores', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await page.locator('.tut-box button').click();
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Ajustes/ }).click();
  await page.getByLabel(/^Ambiente/).check();
  await page.getByLabel(/^Música/).check();
  const music = page.locator('label.volume', { hasText: 'Volumen de la música' }).locator('input');
  await music.fill('-10');
  await expect(page.locator('label.volume', { hasText: 'Volumen de la música' })).toContainText('-10 dB');
  await expect(music).toHaveAttribute('aria-valuetext', '-10 dB');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bitopolis.prefs') ?? '{}'));
  expect(saved).toMatchObject({ musicDb: -10, music: true, ambience: true });
  // Juega unos segundos con música y ambiente activos.
  await page.locator('.sheet-close').click();
  await page.locator('[data-speed="10"]').click();
  await page.waitForTimeout(3000);
  expect(errors).toEqual([]);
});
