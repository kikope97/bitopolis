import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { setSpeed, skipTutorial } from './helpers.ts';
import { runSimulation } from '../packages/sim/src/index.ts';

/** Pueblo a 10 días de votar con dos candidaturas en la oposición (semilla medida). */
function town() {
  const { state } = runSimulation({ seed: 4, days: 1430, profile: 'agresivo' });
  return { state, file: gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state })) };
}

test('2.2: candidaturas con estilo y promesas; noche electoral con una barra por lista (360 px)', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-v22-listas-${n}.png` });
  const { state, file } = town();
  const lists = state.politics.lists;
  expect(lists.length).toBeGreaterThanOrEqual(2);
  if (info.project.name === 'movil') await page.setViewportSize({ width: 360, height: 740 });
  const r = await request.post('/api/import', { data: file, headers: { 'content-type': 'application/octet-stream' } });
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);

  // Hoja de política: una barra de intención de voto y una tarjeta por candidatura.
  await page.locator('#hud-poll').click();
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('Intención de voto');
  await expect(sheet.locator('.pol-bar.rival')).toHaveCount(lists.length);
  await expect(sheet.locator('.rival-card')).toHaveCount(lists.length);
  for (const l of lists) await expect(sheet.locator('.rival-card', { hasText: `«${l.name}»` })).toBeVisible();
  // Estilo del líder y promesas con su estado (en texto, no solo color).
  await expect(sheet.locator('.rival-card .rival-style').first()).toHaveText(/Populista|Técnico|Conservador|Verde/);
  await expect(sheet.locator('.rival-card .promises .pill').first()).toHaveText(/pendiente|cumplida|rota/);
  await sheet.locator('.rival-card').first().scrollIntoViewIfNeeded();
  // Legible a 360 px: nada se sale de la hoja por el lado.
  const overflow = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot('1-candidaturas');
  await page.locator('.sheet-close').click();

  // Se juega hasta las elecciones: una barra por lista, más la tuya y la abstención.
  // 2.5: un aviso importante puede bajar a x1 (attention); se vuelve a x10 hasta la noche electoral.
  const night = page.locator('.sheet h2', { hasText: 'Noche electoral' });
  for (let i = 0; i < 90 && !(await night.count()); i++) {
    if ((await page.locator('#speed').textContent()) !== 'x10' || (await page.locator('#play-pause').getAttribute('data-paused')) === 'true') {
      if (await page.locator('.sheet-close').count()) await page.locator('.sheet-close').first().click();
      await setSpeed(page, 10);
    }
    await page.waitForTimeout(1_000);
  }
  await expect(page.locator('.sheet h2')).toHaveText('Noche electoral', { timeout: 10_000 });
  await setSpeed(page, 0);
  await expect(page.locator('.sheet .pol-bar.rival')).toHaveCount(lists.length);
  await expect(page.locator('.sheet .pol-bar')).toHaveCount(lists.length + 2);
  await expect(page.locator('.sheet')).toContainText(`Se presentaron ${lists.length + 1} candidaturas`);
  await page.waitForTimeout(1600);
  await shot('2-noche-electoral');
  expect(errors).toEqual([]);
});
