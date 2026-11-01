import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, OUTSIDE, runSimulation, transfer, TRASH, TREASURY, trashServed, updateFields, validateCommand } from '../packages/sim/src/index.ts';
import { chooseOffer, pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/** 2.1: basura y punto limpio. */
function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext, s: GameState) {
  const { token } = await (await request.post('/api/import', { data: pack(s), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

async function inspect(page: Page, x: number, y: number) {
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);
  const p = await tile(page, x, y);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.sheet')).toBeVisible();
}

test('2.1: sin recogida hay bolsas y ratas; el punto limpio se construye, su camión recoge y se ve en la capa «Limpieza»', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-basura-${n}.png` });

  // Un pueblo de 500 días sin punto limpio: la basura ya cuenta y dos casas la tienen en la puerta.
  const { state: s } = runSimulation({ seed: 3, days: 500, profile: 'constructor' });
  s.buildings = s.buildings.filter((b) => b.kind !== 'cleanpoint');
  s.weather = { kind: 'sol', until: s.tick + 30 * 24 };
  transfer(s, OUTSIDE, TREASURY, 30_000, 'subvencion');
  const hall = s.buildings.find((b) => b.kind === 'townhall')!;
  const homes = s.buildings
    .filter((b) => (b.kind === 'house' || b.kind === 'res') && b.built && s.citizens.some((c) => c.homeId === b.id))
    .sort((a, b) => Math.abs(a.x - hall.x) + Math.abs(a.y - hall.y) - (Math.abs(b.x - hall.x) + Math.abs(b.y - hall.y)));
  const rats = homes[0]!;
  const bags = homes[1]!;
  rats.trash = TRASH.ratsAt + 10;
  bags.trash = TRASH.dirtyAt + 5;
  updateFields(s);
  // Sitio para el punto limpio: el más cerca del ayuntamiento donde se puede construir y su camión llegaría a la casa de las ratas.
  let spot: { x: number; y: number } | null = null;
  for (let d = 1; d < 12 && !spot; d++) {
    for (let dy = -d; dy <= d && !spot; dy++) {
      for (let dx = -d; dx <= d && !spot; dx++) {
        const x = hall.x + dx;
        const y = hall.y + dy;
        if (Math.abs(dx) + Math.abs(dy) !== d || !validateCommand(s, { type: 'Build', kind: 'cleanpoint', x, y }).ok) continue;
        const t = structuredClone(s);
        t.buildings.push({ id: 999_999, kind: 'cleanpoint', x, y, owner: 0, cash: 0, built: true, hasWater: false, hasPower: false, unpaidMonths: 0 });
        if (trashServed(t).has(rats.id)) spot = { x, y };
      }
    }
  }
  expect(spot).not.toBeNull();
  await openTown(page, request, s);
  await setSpeed(page, 0);

  // Ficha: la basura sale en la tabla de servicios.
  await inspect(page, rats.x, rats.y);
  await expect(page.locator('.sheet .svc-table')).toContainText('Basura');
  await expect(page.locator('.sheet')).toContainText(/Ratas/);
  await shot('1-ficha-ratas');
  await page.locator('.sheet-close').click();

  // Capa «Limpieza» con leyenda.
  await page.locator('#layers').click();
  await page.getByRole('radio', { name: 'Limpieza' }).click();
  await expect(page.locator('#legend')).toContainText('Ratas');
  await shot('2-capa-limpieza');
  await page.locator('#layers').click();
  await page.getByRole('radio', { name: 'Qué falta' }).click();
  await expect(page.locator('#legend')).toContainText('Recogida de basura');
  await page.locator('#layers').click();
  await page.getByRole('radio', { name: 'Sin capa' }).click();

  // La herramienta está en la bandeja, con su precio, y se construye.
  await pickTool(page, 'cleanpoint');
  await expect(page.locator('#strip')).toContainText('camión');
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [spot!.x, spot!.y]);
  const p = await tile(page, spot!.x, spot!.y);
  await page.mouse.click(p.x, p.y);
  const yes = page.locator('#confirm-yes');
  if (await yes.isVisible()) {
    await page.waitForTimeout(400);
    await yes.click();
  }
  await chooseOffer(page);
  await expect.poll(async () => (await state(page)).buildings.some((b: { kind: string }) => b.kind === 'cleanpoint'), { timeout: 10_000 }).toBe(true);

  // Termina la obra y el camión recoge: la casa de las ratas queda limpia.
  await setSpeed(page, 10);
  await expect
    .poll(
      async () => {
        const st = await state(page);
        const built = st.buildings.some((b: { kind: string; built: boolean }) => b.kind === 'cleanpoint' && b.built);
        return built && (st.buildings.find((b: { id: number }) => b.id === rats.id)?.trash ?? 0) === 0;
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe(true);
  await setSpeed(page, 0);
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [spot!.x, spot!.y]);
  await shot('3-camion');
  const cp = (await state(page)).buildings.find((b: { kind: string }) => b.kind === 'cleanpoint');
  await pickTool(page, 'inspect');
  await inspect(page, cp.x, cp.y);
  await expect(page.locator('.sheet')).toContainText('El camión recorre');
  await expect(page.locator('.sheet .level-box')).toContainText('Nivel 1 de 3');
  await shot('4-ficha-punto-limpio');
  expect(errors).toEqual([]);
});
