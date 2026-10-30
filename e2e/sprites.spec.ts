import { expect, test } from '@playwright/test';

/** Hoja de sprites ampliada para revisar el arte (solo escritorio). */
test('hoja de sprites', async ({ page }, info) => {
  test.skip(info.project.name !== 'escritorio');
  await page.goto('/');
  await page.getByRole('button', { name: 'Jugar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await page.evaluate(() => {
    const kinds = ['townhall', 'house', 'water', 'power', 'park', 'school', 'clinic', 'shop', 'factory', 'res', 'res', 'res'];
    const sheet = document.createElement('canvas');
    const Z = 4;
    sheet.width = 6 * 34 * Z;
    sheet.height = 2 * 50 * Z;
    sheet.id = 'sheet';
    const g = sheet.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#71aa34';
    g.fillRect(0, 0, sheet.width, sheet.height);
    const tools = document.querySelectorAll<HTMLCanvasElement>('.tool-icon canvas');
    void tools;
    const api = (window as any).__bitopolis;
    kinds.forEach((k, i) => {
      const c = api.sprite(k, i * 37 + 5);
      g.drawImage(c, (i % 6) * 34 * Z, Math.floor(i / 6) * 50 * Z, 32 * Z, 48 * Z);
    });
    document.body.replaceChildren(sheet);
    document.body.style.background = '#1a1c2c';
  });
  await page.locator('#sheet').screenshot({ path: 'test-results/capturas/sprites.png' });
});
