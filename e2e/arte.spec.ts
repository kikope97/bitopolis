import { gzipSync } from 'node:zlib';
import { skipTutorial } from './helpers.ts';
import { expect, test } from '@playwright/test';
import { runSimulation, step } from '../packages/sim/src/index.ts';

/** Pueblo grande a una hora concreta (el día empieza a las 8:00: +13 h son las 21:00). */
function town(hours: number) {
  const { state } = runSimulation({ seed: 1, days: 420, profile: 'constructor' });
  for (let i = 0; i < hours; i++) step(state);
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

for (const [name, hours] of [
  ['dia', 4],
  ['atardecer', 12],
  ['noche', 15],
] as const) {
  test(`v0.5: arte de ${name} con vecinos, humo y viento`, async ({ page, request }, info) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const r = await request.post('/api/import', { data: town(hours), headers: { 'content-type': 'application/octet-stream' } });
    const { token } = await r.json();
    await page.goto(`/p/${token}`);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await skipTutorial(page);
    await expect(page.locator('#game')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/capturas/${info.project.name}-v05-${name}.png` });
    expect(errors).toEqual([]);
  });
}
