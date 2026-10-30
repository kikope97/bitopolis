import { expect, test } from '@playwright/test';

/** Muestra de la fuente pixel propia (opción de Ajustes) para revisarla a ojo. */
test('fuente pixel: carga y se aplica desde Ajustes', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Configurar/ }).click();
  await page.getByRole('button', { name: /Ajustes/ }).click();
  await page.getByRole('radiogroup', { name: 'Letra' }).getByRole('radio', { name: /Pixel/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'pixel');
  await page.locator('.sheet-close').click();
  expect(await page.evaluate(async () => (await document.fonts.load("22px 'Bitopolis Pixel'", 'Bitópolis ñ ¿?')).length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'muestra';
    p.textContent = 'ÁÉÍÓÚ Ñ áéíóú ñ ü ¿Qué tal, alcaldesa? ¡Bien! 1.234,56 € · «Plaza Mayor» 98 % (x10) — Año 5 · ✓ ✗ ▸';
    document.querySelector('main')!.prepend(p);
  });
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-fuente-pixel.png` });
});
