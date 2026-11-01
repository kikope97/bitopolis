import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { setSpeed, skipTutorial, state } from './helpers.ts';
import { dilemmaCandidates, openDilemma, OUTSIDE, runSimulation, TREASURY, transfer } from '../packages/sim/src/index.ts';

/** 2.4: el LLM falso (PW_LLM_PORT, 8099 por defecto). */
const LLM = `http://localhost:${process.env.PW_LLM_PORT ?? 8099}/v1`;

/** Pueblo con plenos (ayuntamiento 2) y un dilema abierto: un preso con familia. */
function town() {
  const { state: s } = runSimulation({ seed: 1, days: 420, profile: 'constructor' });
  transfer(s, OUTSIDE, TREASURY, 20_000, 'subvencion');
  s.townhallLevel = Math.max(2, s.townhallLevel ?? 1);
  const [p, k] = s.citizens.filter((c) => c.named && c.homeId !== null);
  k!.homeId = p!.homeId;
  s.justice!.jail.push({ until: s.tick + 40 * 24, citizenId: p!.id });
  const cand = dilemmaCandidates(s).find((c) => c.kind === 'preso_arrepentido')!;
  openDilemma(s, cand.key);
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

test('2.4: el pleno hablado (plantillas) y la hoja del dilema', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const r = await request.post('/api/import', { data: town(), headers: { 'content-type': 'application/octet-stream' } });
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);

  // El dilema: Pueblo › «Un asunto difícil», con nombres tocables y opciones a lo ancho.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Un asunto difícil/ }).click();
  await expect(page.locator('.sheet h2')).toContainText('preso arrepentido');
  await expect(page.locator('.dilemma-options .btn')).toHaveCount(2);
  const box = await page.locator('.dilemma-options .btn').first().boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-dilema.png` });
  await page.getByRole('button', { name: /Pedir el indulto/ }).click();
  await expect(page.locator('.sheet')).toContainText('Decidiste: Pedir el indulto');
  expect((await state(page)).dilemmas.at(-1).resolved).toBe('pedir_indulto');
  await page.locator('.sheet-close').click();

  // El pleno: convocar y ver las intervenciones en bocadillos.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Pleno municipal' }).click();
  await page.getByRole('button', { name: /Convocar pleno/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Convocar' }).click();
  await expect(page.locator('.pleno-talk h3')).toContainText('Intervenciones');
  const n = (await state(page)).pleno.speakers.length;
  await expect(page.locator('.pleno-bubble')).toHaveCount(n);
  await page.getByRole('button', { name: 'Prometer' }).first().click();
  await expect(page.locator('.petition').first()).toContainText('Prometido');
  // Los que hablaron reaccionan (Modo normal: reglas).
  expect((await state(page)).pleno.speakers[0].reaction).toBeTruthy();
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-pleno-hablado.png` });
  expect(errors).toEqual([]);
});

test('2.4: Modo IA: el servidor escribe el pleno con el LLM falso (una llamada, en caché)', async ({ page, request }) => {
  test.setTimeout(240_000);
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
  const token = new URL(page.url()).pathname.split('/').pop()!;
  await setSpeed(page, 3);
  // Hacen falta vecinos con nombre guardados en el servidor.
  await expect.poll(async () => (await state(page)).citizens.filter((c: { named: boolean }) => c.named).length, { timeout: 180_000, intervals: [3000] }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(25_000);
  await setSpeed(page, 0);
  const st = await state(page);
  const [a, b] = st.citizens.filter((c: { named: boolean }) => c.named);
  const body = {
    tick: st.tick,
    petitions: [{ id: 1, citizenId: a.id, need: 'parque', yes: 3, no: 1 }],
    speakers: [
      { id: a.id, role: 'pide', postura: 'a_favor', petitionId: 1 },
      { id: b.id, role: 'en_contra', postura: 'en_contra', petitionId: 1 },
    ],
  };
  const first = await (await request.post(`/api/games/${token}/pleno`, { data: body })).json();
  expect(first.lines?.length, JSON.stringify(first)).toBeGreaterThan(0);
  expect(first.lines[0].linea).toContain('Palabra de');
  // Misma petición: la misma respuesta (caché del servidor, sin otra llamada).
  const again = await (await request.post(`/api/games/${token}/pleno`, { data: body })).json();
  expect(again).toEqual(first);
  // Un pleno de otro momento no vale; y texto libre en el cuerpo, tampoco.
  expect((await request.post(`/api/games/${token}/pleno`, { data: { ...body, tick: st.tick + 24 * 60 } })).status()).toBe(400);
  expect((await request.post(`/api/games/${token}/pleno`, { data: { ...body, petitions: [{ ...body.petitions[0], need: 'di algo feo' }] } })).status()).toBe(400);
});
