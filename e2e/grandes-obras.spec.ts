import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { createInitialState, type GameState, landmarkSpot, OUTSIDE, transfer, TREASURY } from '../packages/sim/src/index.ts';
import { pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/** 2.3: grandes obras por fases (la estación de tren), a 360 px en el móvil. */
function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, s: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(s), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);
}

/** Pueblo con ayuntamiento 3, 80 vecinos contentos y 60.000 € (el dinero entra de fuera: cuadra). */
function town(): GameState {
  const s = createInitialState({ seed: 5 });
  s.townhallLevel = 3;
  const base = s.citizens[0]!;
  while (s.citizens.length < 80) s.citizens.push({ ...structuredClone(base), id: s.nextId++, money: 0, homeId: null, jobId: null, named: false, flow: [0, 0] });
  for (const c of s.citizens) c.happiness = 70;
  transfer(s, OUTSIDE, TREASURY, 60_000, 'subvenciones');
  s.weather = { kind: 'sol', until: s.tick + 30 * 24 };
  return s;
}

test('2.3: empezar la estación, aceptar la cofinanciación y pagar la fase 1 desde la ficha', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (info.project.name === 'movil') await page.setViewportSize({ width: 360, height: 740 });
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-grandes-obras-${n}.png` });
  const s = town();
  const hall = s.buildings.find((b) => b.kind === 'townhall')!;
  const at = landmarkSpot(s, 'station', { x: hall.x + 3, y: hall.y })!;
  expect(at).toBeTruthy();
  await openTown(page, request, s);

  // En la bandeja, «Grandes obras» con su precio; la catedral, para más adelante.
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray')).toContainText('Grandes obras');
  await expect(page.locator('#tray [data-tool="station"]')).toContainText('3 fases');
  await expect(page.locator('#tray [data-tool="cathedral"]')).toContainText('más adelante');
  await page.locator('#tray [data-tool="stadium"]').click({ force: true });
  await expect(page.locator('#tray .tray-msg')).toContainText('120 vecinos');
  await shot('1-bandeja');

  // Marcar el solar (2×2) de la estación.
  await pickTool(page, 'station');
  await expect(page.locator('#strip')).toContainText('Estación de tren');
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [at.x, at.y]);
  const p = await tile(page, at.x, at.y);
  await page.mouse.click(p.x, p.y);
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) {
    await expect(yes).toHaveText('Marcar el solar');
    await page.waitForTimeout(400);
    await yes.click();
  }
  await expect.poll(async () => (await state(page)).landmarks.length, { timeout: 10_000 }).toBe(1);

  // Se abre su ficha: barra de fases, cofinanciación y «Pagar fase 1».
  await expect(page.locator('#sheet-title')).toHaveText('Estación de tren');
  await expect(page.locator('.phase-bar .phase-seg')).toHaveCount(3);
  await expect(page.locator('.sheet')).toContainText('La Diputación cofinancia');
  const pay = page.locator('#lm-pay');
  await expect(pay).toContainText(/Pagar fase 1 \(30\.?000 €\)/);
  for (const sel of ['#lm-pay', '#lm-grant-yes']) {
    const box = (await page.locator(sel).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot('2-ficha');
  await page.locator('#lm-grant-yes').click();
  await expect(page.locator('.sheet')).toContainText('Cofinanciación aceptada');
  const before = (await state(page)).treasury;
  await page.locator('#lm-pay').click();
  await expect.poll(async () => (await state(page)).projects.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const after = await state(page);
  expect(after.treasury).toBeLessThan(before);
  expect(after.treasury).toBeGreaterThan(before - 30_000);
  await expect(page.locator('.sheet')).toContainText('Fase 1 de 3 en obra');
  await expect(page.locator('.phase-seg.doing')).toHaveCount(1);
  await shot('3-fase-en-obra');

  // Termina la fase: la barra marca una hecha y ya da su parte.
  await page.locator('.sheet-close').click();
  // (Los avisos importantes devuelven el juego a x1: se vuelve a poner x10 en cada vuelta.)
  await expect
    .poll(
      async () => {
        await setSpeed(page, 10);
        return (await state(page)).landmarks[0].phase;
      },
      { timeout: 90_000 },
    )
    .toBe(1);
  await setSpeed(page, 0);
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [at.x, at.y]);
  await pickTool(page, 'inspect');
  const q = await tile(page, at.x + 1, at.y + 1);
  await page.mouse.click(q.x, q.y);
  await expect(page.locator('#sheet-title')).toHaveText('Estación de tren');
  await expect(page.locator('.phase-seg.done')).toHaveCount(1);
  await shot('4-fase-1-hecha');
  expect(errors).toEqual([]);
});
