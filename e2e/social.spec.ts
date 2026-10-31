import { gzipSync } from 'node:zlib';
import { skipTutorial } from './helpers.ts';
import { expect, test } from '@playwright/test';
import { runSimulation } from '../packages/sim/src/index.ts';

function town() {
  const { state } = runSimulation({ seed: 1, days: 420, profile: 'constructor' });
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

test('v0.4: ficha y hablar, pleno con promesa, consejero, diario y objetivos', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v04-${n}.png` });
  const r = await request.post('/api/import', { data: town(), headers: { 'content-type': 'application/octet-stream' } });
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  // v1.6: los objetivos están en el panel «Pueblo» (ya no flotan sobre el mapa).
  await page.locator('#menu').click();
  await expect(page.locator('.sheet')).toContainText('Objetivos');
  await shot('1-objetivos');
  await page.locator('.sheet-close').click();

  // Vecinos → ficha → hablar.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Vecinos' }).click();
  await page.locator('.person-row').first().click();
  await expect(page.locator('.sheet h2')).toContainText('★');
  await expect(page.locator('.sheet')).toContainText('Relaciones');
  await page.getByRole('button', { name: '¿Cómo estás?' }).click();
  await expect(page.locator('.answer')).toContainText('«');
  await shot('2-ficha');
  await page.locator('.sheet-close').click();

  // Pleno: convocar, prometer y cerrar.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Pleno municipal' }).click();
  await page.getByRole('button', { name: /Convocar pleno/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Convocar' }).click();
  await expect(page.locator('.petition').first()).toContainText('pide');
  await expect(page.locator('.petition').first()).toContainText('Votos');
  await expect(page.locator('.petition').first()).toContainText('Si prometes: plazo hasta');
  await shot('3-pleno');
  await page.getByRole('button', { name: 'Prometer' }).first().click();
  await expect(page.locator('.petition').first()).toContainText('Prometido');
  // Responder no rehace la hoja: el foco pasa a la siguiente petición o a «Cerrar el pleno».
  await expect(page.locator('.sheet :focus')).toHaveText(/Prometer|Cerrar el pleno/);
  await page.getByRole('button', { name: 'Cerrar el pleno' }).click();
  await expect(page.locator('.sheet')).toContainText('pendiente');
  await page.locator('.sheet-close').click();

  // Consejero y diario.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Consejero' }).click();
  await page.getByRole('button', { name: '¿Qué cambiarías?' }).click();
  await expect(page.locator('.advice p').first()).not.toBeEmpty();
  await shot('4-consejero');
  await page.locator('.sheet-close').click();
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Diario del pueblo' }).click();
  await expect(page.locator('.sheet h3').first()).toContainText('Año');
  await shot('5-diario');
  expect(errors).toEqual([]);
});
