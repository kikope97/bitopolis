import { gzipSync } from 'node:zlib';
import { skipTutorial } from './helpers.ts';
import { expect, test } from '@playwright/test';
import { applyCommand, runSimulation } from '../packages/sim/src/index.ts';

/** Pueblo grande generado con el motor e importado como copia .bitopolis. */
function bigTown() {
  const { state } = runSimulation({ seed: 1, days: 420, profile: 'constructor' });
  const cx = state.map.w / 2;
  const cy = state.map.h / 2;
  applyCommand(state, { type: 'Build', kind: 'house', x: cx + 1, y: cy + 1 });
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

test('v0.3: tributos separados, capas, venta de vivienda, parte y vecinos', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v03-${n}.png` });
  const r = await request.post('/api/import', { data: bigTown(), headers: { 'content-type': 'application/octet-stream' } });
  expect(r.ok()).toBe(true);
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await expect(page.locator('.stats-card')).toContainText('vecinos');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await skipTutorial(page);
  await shot('1-pueblo');

  // Tributos separados con glosario y nombres afectados.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Impuestos' }).click();
  await expect(page.locator('.sheet')).toContainText('Tributos municipales');
  await expect(page.locator('.sheet')).toContainText('IBI');
  await expect(page.locator('.sheet .affects').first()).toContainText('Afecta a');
  await page.getByRole('radiogroup', { name: 'IBI' }).getByRole('radio', { name: /Alto/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'IBI' }).getByRole('radio', { name: /Alto/ })).toHaveAttribute('aria-checked', 'true');
  await shot('2-tributos');
  await page.locator('.sheet-close').click();

  // Capas de datos con leyenda.
  for (const label of ['Felicidad', 'Valor del suelo', 'Cobertura', 'Contaminación']) {
    await page.locator('#layers').click();
    await expect(page.locator('#legend')).toContainText(label);
    if (label === 'Valor del suelo') await shot('3-capa-suelo');
    if (label === 'Felicidad') await shot('3-capa-felicidad');
  }
  await page.locator('#layers').click();
  await expect(page.locator('#legend')).toBeHidden();

  // Casa municipal: poner a la venta.
  const st = await page.evaluate(() => (window as any).__bitopolis.state);
  const house = st.buildings.find((b: { kind: string; built: boolean }) => b.kind === 'house' && b.built);
  const p = await page.evaluate(([x, y]) => (window as any).__bitopolis.tileCenter(x, y), [house.x, house.y]);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.sheet')).toContainText('Valor de mercado');
  await page.getByRole('button', { name: 'Poner a la venta' }).click();
  await expect(page.getByRole('button', { name: 'Pasar a alquiler' })).toBeVisible();
  await shot('4-venta');
  await page.locator('.sheet-close').click();

  // Parte mensual y lista de vecinos.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Parte mensual' }).click();
  await expect(page.locator('.sheet')).toContainText('Parte de');
  await expect(page.locator('.sheet')).toContainText('IBI');
  await shot('5-parte');
  await page.locator('.sheet-close').click();
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Vecinos' }).click();
  await expect(page.locator('.sheet')).toContainText('población estadística');
  await shot('6-vecinos');
  expect(errors).toEqual([]);
});
