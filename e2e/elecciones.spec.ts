import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { setSpeed } from './helpers.ts';
import { runSimulation } from '../packages/sim/src/index.ts';

/** Pueblo con impuestos altos a 4 días de votar: hay partido rival y la intención de voto es baja. */
function town() {
  const { state } = runSimulation({ seed: 5, days: 1436, profile: 'agresivo' });
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

test('v1.0: intención de voto, facciones, noche electoral y oposición', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v10-${n}.png` });
  const r = await request.post('/api/import', { data: town(), headers: { 'content-type': 'application/octet-stream' } });
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.locator('.tut-box button').click();

  // Indicador de intención de voto y hoja de política.
  await expect(page.locator('#hud-poll')).toContainText('%');
  // Quedan menos de 3 meses: el indicador lleva la cuenta atrás (v1.3).
  await expect(page.locator('#hud-poll')).toHaveText(/· \d+ d$/);
  await page.locator('#hud-poll').click();
  await expect(page.locator('.sheet')).toContainText('Intención de voto');
  // El partido rival depende de la semilla: basta con que la hoja lo enseñe.
  await expect(page.locator('.sheet')).toContainText(/Oposición«|«.+»/);
  await expect(page.locator('.faction')).toHaveCount(4);
  await shot('1-politica');
  await page.getByRole('button', { name: /Hacer campaña con/ }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Hacer campaña' }).click();
  await expect(page.locator('.sheet')).toContainText('Campaña: ●');
  await page.locator('.sheet-close').click();

  // Se juega hasta las elecciones.
  await setSpeed(page, 10);
  await expect(page.locator('.sheet h2')).toHaveText('Noche electoral', { timeout: 60_000 });
  await expect(page.locator('.sheet')).toContainText('votos');
  await page.waitForTimeout(1600);
  await shot('2-noche-electoral');
  const lost = (await page.locator('.sheet').textContent())!.includes('Pierdes');
  await page.locator('.sheet-close').click();
  if (lost) {
    // En la oposición no se puede gobernar.
    await expect(page.locator('#hud-poll')).toContainText('Oposición');
    await page.locator('#menu').click();
    await page.getByRole('button', { name: 'Impuestos' }).click();
    await expect(page.locator('.sheet')).toContainText('Estás en la oposición');
    await expect(page.getByRole('radio')).toHaveCount(0);
    await shot('3-oposicion');
    await page.locator('.sheet-close').click();
    // Moción desde la oposición: el pleno la aprueba o la rechaza, y queda registrada.
    await page.locator('#hud-poll').click();
    const motion = page.getByRole('button', { name: /Presentar moción/ }).first();
    await expect(motion).toBeVisible();
    await motion.click();
    await expect(page.locator('#toasts')).toContainText(/moción/);
    await shot('4-mocion');
  }
  expect(errors).toEqual([]);
});
