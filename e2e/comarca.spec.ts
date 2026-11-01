import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { setSpeed, skipTutorial, state } from './helpers.ts';
import { applyNeighborAct, neighborTemplate, runSimulation } from '../packages/sim/src/index.ts';

/** 2.5: el LLM falso (PW_LLM_PORT). */
const LLM = `http://localhost:${process.env.PW_LLM_PORT ?? 8099}/v1`;

/** Pueblo con la comarca ya creada y una oferta de cosecha por responder. */
function town() {
  const { state: s } = runSimulation({ seed: 4, days: 45, profile: 'constructor' });
  const t = s.comarca.towns[0]!;
  applyNeighborAct(s, t, 'ofrecer_acuerdo:cosecha', neighborTemplate(s, t, 'ofrecer_acuerdo:cosecha'), 'reglas');
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

test('2.5: Pueblo › Comarca: una tarjeta por pueblo y la oferta con Aceptar/Rechazar a 360 px', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 360, height: 740 });
  const r = await request.post('/api/import', { data: town(), headers: { 'content-type': 'application/octet-stream' } });
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
  const st = await state(page);
  expect(st.comarca.towns).toHaveLength(3);

  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Pueblos vecinos/ }).click();
  await expect(page.locator('.sheet h2')).toContainText('Pueblos vecinos');
  await expect(page.locator('.comarca-town')).toHaveCount(3);
  const first = page.locator('.comarca-town').first();
  await expect(first).toContainText(st.comarca.towns[0].mayor.name);
  await expect(first).toContainText('Relación');
  await expect(first.locator('.comarca-said')).toBeVisible();
  await expect(first.locator('.comarca-offer')).toContainText('acuerdo de cosecha');
  for (const name of ['Aceptar', 'Rechazar']) {
    const box = await first.getByRole('button', { name: new RegExp(`^${name}`) }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-comarca.png` });
  await first.getByRole('button', { name: /^Aceptar/ }).click();
  await expect(first).toContainText('Acuerdo de cosecha hasta');
  const after = await state(page);
  const offer = after.comarca.offers.at(-1);
  expect(offer.resolved).toBe('accepted');
  expect(offer.dealUntil).toBeGreaterThan(after.tick);
  expect(errors).toEqual([]);
});

test('2.5: Modo IA: los alcaldes vecinos hablan con el LLM falso y la oferta llega con aviso fijo', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.getByRole('radio', { name: /Modo IA/ }).click();
  await page.locator('details.advanced summary').first().click();
  await page.locator('#ai-base').fill(LLM);
  await page.getByRole('button', { name: 'Cargar modelos' }).click();
  await page.locator('#ai-model-list').selectOption('falso-mini');
  await page.locator('#ai-accept').check();
  await page.getByRole('button', { name: 'Guardar y usar el Modo IA' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 10);
  // Al primer cierre de mes se abre el turno de los alcaldes; el servidor pregunta y el cliente aplica `NeighborTurn`.
  await expect
    .poll(async () => ((await state(page)).comarca?.towns ?? []).filter((t: { saidBy?: string }) => t.saidBy === 'ia').length, { timeout: 240_000, intervals: [3000] })
    .toBeGreaterThan(0);
  await setSpeed(page, 0);
  const st = await state(page);
  const spoke = st.comarca.towns.find((t: { saidBy?: string }) => t.saidBy === 'ia');
  expect(spoke.said).toContain('tendemos la mano');
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Pueblos vecinos/ }).click();
  await expect(page.locator('.comarca-said').first()).toContainText('✦');
  // Si alguno ofreció un acuerdo, hay aviso fijo en la campana.
  if (st.comarca.offers.some((o: { resolved?: string }) => !o.resolved)) await expect(page.locator('.comarca-offer').first()).toBeVisible();
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-comarca-ia.png` });
});
