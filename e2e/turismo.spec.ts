import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, runSimulation, validateCommand } from '../packages/sim/src/index.ts';
import { chooseOffer, pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/** 2.3: turismo y patrimonio (construir el patrimonio, tasa, entorno protegido y capa «Casas rurales»). */
function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, s: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(s), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

/** Los botones se tocan bien con el dedo: 44 px como mínimo. */
async function expectTappable(page: Page, selector: string) {
  for (const box of await page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
}

test('2.3: se construye el patrimonio, se cambia la tasa, se protege el entorno y se ve la capa', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-turismo-${n}.png` });

  // Un pueblo con el ayuntamiento de nivel 3 o más y más de 40 vecinos (sin patrimonio: este perfil no lo construye).
  const s = runSimulation({ seed: 42, days: 600, profile: 'ahorrador' }).state;
  expect(s.citizens.length).toBeGreaterThanOrEqual(40);
  expect(s.buildings.some((b) => b.kind === 'heritage')).toBe(false);
  s.weather = { kind: 'sol', until: s.tick + 30 * 24 };
  // Una casa rural ya abierta (para la capa).
  const owner = s.citizens.find((c) => c.owns && c.homeId !== null);
  const rural = owner ? s.buildings.find((b) => b.id === owner.homeId) : undefined;
  if (rural) rural.rural = true;
  const hall = s.buildings.find((b) => b.kind === 'townhall')!;
  let spot: { x: number; y: number } | null = null;
  for (let d = 1; d < 16 && !spot; d++) {
    for (let dy = -d; dy <= d && !spot; dy++) {
      for (let dx = -d; dx <= d && !spot; dx++) {
        if (Math.abs(dx) + Math.abs(dy) === d && validateCommand(s, { type: 'Build', kind: 'heritage', x: hall.x + dx, y: hall.y + dy }).ok) spot = { x: hall.x + dx, y: hall.y + dy };
      }
    }
  }
  expect(spot).not.toBeNull();
  await openTown(page, request, s);
  await setSpeed(page, 0);

  // En la bandeja, «Turismo › Patrimonio», con su ayuda en la franja.
  await pickTool(page, 'heritage');
  await expect(page.locator('#strip')).toContainText('faro');
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [spot!.x, spot!.y]);
  const p = await tile(page, spot!.x, spot!.y);
  await page.mouse.click(p.x, p.y);
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) {
    await page.waitForTimeout(400);
    await yes.click();
  }
  await chooseOffer(page);
  await expect.poll(async () => (await state(page)).buildings.some((b: { kind: string }) => b.kind === 'heritage'), { timeout: 10_000 }).toBe(true);
  // Solo uno por pueblo: la bandeja lo dice.
  if (await page.locator('#tray').isHidden()) await page.locator('#tab-build').click();
  await expect(page.locator('#tray [data-tool="heritage"]')).toContainText('ya lo tienes');
  await page.locator('#tab-inspect').click();

  // Termina la obra.
  await setSpeed(page, 10);
  await expect.poll(async () => (await state(page)).buildings.some((b: { kind: string; built: boolean }) => b.kind === 'heritage' && b.built), { timeout: 90_000, intervals: [1000] }).toBe(true);
  await setSpeed(page, 0);
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [spot!.x, spot!.y]);
  await shot('1-patrimonio');

  // Pueblo › Ayuntamiento › Turismo, a 360 px.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /^Turismo ·/ }).click();
  await expect(page.locator('#th-tourism')).toBeVisible();
  await expect(page.locator('.sheet')).toContainText('Tasa turística');
  await expectTappable(page, '.sheet [data-tax]');
  await expectTappable(page, '#protect-area');
  await page.locator('.sheet [data-tax="2"]').click();
  await expect.poll(async () => (await state(page)).tourism.tax).toBe(2);
  await expect(page.locator('.sheet [data-tax="2"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#protect-area').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Proteger' }).click();
  await expect.poll(async () => (await state(page)).tourism.protectedId).toBeGreaterThan(0);
  await expect(page.locator('#protect-area')).toHaveText('Levantar la protección');
  await page.locator('#th-tourism').scrollIntoViewIfNeeded();
  await shot('2-hoja-360');
  // Nada se sale de la pantalla a 360 px.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('.sheet-close').click();

  // Capa «Casas rurales» con su leyenda.
  await page.locator('#layers').click();
  await page.getByRole('radio', { name: 'Casas rurales' }).click();
  await expect(page.locator('#legend')).toContainText('Casa rural');
  await expect(page.locator('#legend')).toContainText('Patrimonio y entorno');
  if (rural) await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [rural.x, rural.y]);
  await shot('3-capa-360');
  expect(errors).toEqual([]);
});
