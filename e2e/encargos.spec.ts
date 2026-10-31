import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { skipTutorial, state } from './helpers.ts';
import { errandCandidates, runSimulation } from '../packages/sim/src/index.ts';

/** 2.1: un pueblo con un encargo por responder y el periódico ya publicado. */
function town() {
  const { state } = runSimulation({ seed: 3, days: 240, profile: 'constructor' });
  for (const c of state.citizens) c.happiness = 40;
  const es = state.errands!;
  es.list = [];
  es.recent = [];
  const cand = errandCandidates(state)[0]!;
  es.list.push({ id: state.nextId++, ...cand, status: 'ofrecido', until: state.tick + 14 * 24, story: 'Alcalde, se lo pido por mis nietos.' });
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

test('2.1: encargos del pueblo y El Eco de Bitópolis', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v21-${n}.png` });
  const r = await request.post('/api/import', { data: town(), headers: { 'content-type': 'application/octet-stream' } });
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);

  await page.locator('#menu').click();
  await expect(page.locator('.sheet')).toContainText('Encargos y El Eco');
  await page.getByRole('button', { name: 'Encargos del pueblo' }).click();
  await expect(page.locator('.errand').first()).toContainText('por mis nietos');
  await shot('encargos');
  await page.getByRole('button', { name: 'Prometer' }).first().click();
  await expect(page.locator('.errand').first()).toContainText('Prometido');
  const s = await state(page);
  expect(s.errands.list.some((e: { status: string }) => e.status === 'aceptado')).toBe(true);

  // El Eco: la última edición y su respuesta.
  await page.locator('.sheet-back, .sheet-close').first().click();
  if (!(await page.getByRole('button', { name: 'El Eco de Bitópolis' }).isVisible())) await page.locator('#menu').click();
  await page.getByRole('button', { name: 'El Eco de Bitópolis' }).click();
  await expect(page.locator('.press-ed.latest')).toBeVisible();
  await shot('el-eco');
  await page.getByRole('button', { name: /^Agradecer/ }).click();
  await expect(page.locator('.press-ed.latest')).toContainText('Ya contestaste');
  expect(errors).toEqual([]);
});
