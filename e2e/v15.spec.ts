import { gzipSync } from 'node:zlib';
import { skipTutorial } from './helpers.ts';
import { expect, test } from '@playwright/test';
import { runSimulation } from '../packages/sim/src/index.ts';

/** v1.5: hoja del Ayuntamiento (presupuesto, fiestas, subvenciones y censo). */
test('v1.5: en enero se presenta el presupuesto y el pleno lo vota', async ({ page, request }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Día 362: 2 de enero del año 2, con el presupuesto por aprobar (los bots no lo presentan).
  const { state } = runSimulation({ seed: 3, days: 362, profile: 'constructor' });
  expect(state.budget.status).toBe('open');
  const data = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
  const { token } = await (await request.post('/api/import', { data, headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await page.locator('#menu').click();
  await page.locator('.hub-grid').getByRole('button', { name: 'Ayuntamiento', exact: true }).click();
  await expect(page.locator('.sheet h2')).toHaveText('Ayuntamiento');
  await expect(page.locator('.sheet')).toContainText('por aprobar');
  await expect(page.locator('.sheet')).toContainText('Censo');
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-v15-ayuntamiento.png` });
  await page.getByRole('button', { name: /Inversor/ }).click();
  await expect(page.locator('.sheet')).toContainText(/aprobado|prorrogado/);
  await expect(page.getByRole('button', { name: /Inversor/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
