import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { cropAt, FARM, type GameState, joinCoop, newBuilding, OUTSIDE, runSimulation, Tile, transfer, TREASURY, validateCommand, Zone } from '../packages/sim/src/index.ts';
import { pickTool, setSpeed, skipTutorial, state, tile } from './helpers.ts';

/** 2.5 «Comarca» (bloques G y H): cooperativa agraria, correos y el buzón de cartas, en el móvil (360 px). */

const LLM = `http://localhost:${process.env.PW_LLM_PORT ?? 8099}/v1`;

function pack(s: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
}

/** Casilla libre junto a carretera, cerca del ayuntamiento, donde se puede construir `kind`. */
function spot(s: GameState, kind: 'coop' | 'post' | 'park'): { x: number; y: number } {
  const th = s.buildings.find((b) => b.kind === 'townhall')!;
  for (let r = 1; r <= 12; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = th.x + dx;
        const y = th.y + dy;
        if (validateCommand(s, { type: 'Build', kind, x, y }).ok) return { x, y };
      }
  throw new Error(`sin sitio para ${kind}`);
}

/** Añade al estado una carta de alguien que se fue a un vecino con nombre (como la crea `postMonth`). */
function addLetter(s: GameState, toId?: number): { id: number; to: number; toName: string; fromName: string } {
  const to = s.citizens.find((c) => (toId === undefined ? c.named : c.id === toId))!;
  const id = s.nextId++;
  s.departed.push({ id, name: 'Ramón Ortega', age: 40, tick: s.tick - 60 * 24, reason: 'se_fue' });
  const letter = { id: s.nextId++, from: id, to: to.id, tick: s.tick, template: 'echo_de_menos' };
  s.letters.push(letter);
  return { id: letter.id, to: to.id, toName: to.name, fromName: 'Ramón' };
}

/** Pueblo de la 2.4 con ayuntamiento de nivel 2, dinero, correos con una carta y una cooperativa con un socio. */
function town() {
  const s = runSimulation({ seed: 1, days: 300, profile: 'constructor' }).state;
  s.townhallLevel = Math.max(2, s.townhallLevel ?? 1);
  transfer(s, OUTSIDE, TREASURY, 40_000, 'subvencion');
  s.weather = { kind: 'sol', until: s.tick + 30 * 24 };
  const at = spot(s, 'post');
  newBuilding(s, 'post', at.x, at.y, TREASURY).built = true;
  const coopAt = spot(s, 'coop');
  newBuilding(s, 'coop', coopAt.x, coopAt.y, TREASURY).built = true;
  // Una finca junto a una carretera con un vecino con nombre que la trabaja (y se hace socio).
  const farmAt = spot(s, 'park');
  s.map.zones[farmAt.y * s.map.w + farmAt.x] = Zone.A;
  s.map.tiles[farmAt.y * s.map.w + farmAt.x] = Tile.Grass;
  const f = newBuilding(s, 'farm', farmAt.x, farmAt.y, OUTSIDE);
  f.built = true;
  f.crop = cropAt(s, f.x, f.y);
  f.yieldFx = FARM.start;
  const farmer = s.citizens.find((c) => c.named && c.jobId === null) ?? s.citizens.find((c) => c.named)!;
  farmer.jobId = f.id;
  joinCoop(s, farmer);
  const letter = addLetter(s, farmer.id);
  return { s, post: at, coop: coopAt, farmer: farmer.name, letter };
}

async function inspect(page: Page, x: number, y: number) {
  await page.evaluate(([a, b]) => (window as any).__bitopolis.centerOn(a, b), [x, y]);
  const p = await tile(page, x, y);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.sheet')).toBeVisible();
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test('2.5: cooperativa y correos en la bandeja, ficha de la cooperativa y buzón con la carta (360 px)', async ({ page, request }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/${info.project.name}-comarca-${n}.png` });
  const { s, coop, post, farmer, letter } = town();
  await page.setViewportSize({ width: 360, height: 780 });
  const { token } = await (await request.post('/api/import', { data: pack(s), headers: { 'content-type': 'application/octet-stream' } })).json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);

  // La bandeja: correos en «Cuidados» y la cooperativa en «Campo»; ya hay una de cada.
  await page.locator('#tab-build').click();
  await expect(page.locator('#tray h3', { hasText: 'Campo' })).toBeVisible();
  await expect(page.locator('#tray [data-tool="coop"] .tool-label')).toHaveText('Cooperativa');
  await expect(page.locator('#tray [data-tool="post"] .tool-label')).toHaveText('Correos');
  await expect(page.locator('#tray [data-tool="coop"] .tool-cost')).toContainText('ya la tienes');
  await page.locator('#tray [data-tool="coop"]').scrollIntoViewIfNeeded();
  await shot('1-bandeja');
  await noOverflow(page);
  await page.locator('#tab-build').click();

  // Ficha de la cooperativa: socios, presidente y reparto.
  await pickTool(page, 'inspect');
  await inspect(page, coop.x, coop.y);
  const box = page.locator('.sheet [data-coop]');
  await expect(box).toContainText('1 socio');
  await expect(box).toContainText(`preside ${farmer}`);
  await expect(box).toContainText('reparto');
  await expect(box).toContainText('A quién afecta');
  await shot('2-cooperativa');
  await noOverflow(page);
  await page.locator('.sheet-close').click();

  // Ficha de correos: plazo de las subvenciones y el buzón.
  await inspect(page, post.x, post.y);
  await expect(page.locator('.sheet [data-post]')).toContainText('30 días');
  await page.locator('#post-mailbox').click();
  await expect(page.locator('.sheet h2')).toContainText('Buzón');
  const row = page.locator(`[data-letter="${letter.id}"]`);
  await expect(row).toContainText(`De ${letter.fromName} para ${letter.toName.split(' ')[0]}`);
  await expect(row).toContainText('sin leer');
  const rb = await row.boundingBox();
  expect(rb!.height).toBeGreaterThanOrEqual(44);
  await row.click();
  // Modo normal: la plantilla del motor.
  await expect(page.locator('.letter-body').first()).toContainText(`Un abrazo muy fuerte, ${letter.fromName}`);
  await shot('3-buzon');
  await noOverflow(page);
  await page.locator('.sheet-close').click();

  // Desde «Pueblo» (Gente › Buzón) y desde la ficha de quien la recibe.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Buzón · 1 carta/ }).click();
  await expect(page.locator('.sheet h2')).toContainText('Buzón');
  await page.locator('.sheet-close').click();
  await pickTool(page, 'inspect');
  await inspect(page, coop.x, coop.y);
  await page.locator('.sheet [data-coop] .person-row').first().click();
  await page.locator('#citizen-letters').click();
  await expect(page.locator('.sheet h2')).toContainText(`Cartas para ${farmer.split(' ')[0]}`);
  await expect(page.locator(`[data-letter="${letter.id}"]`)).toBeVisible();
  expect(errors).toEqual([]);
});

test('2.5: Modo IA: el servidor escribe la carta con el LLM falso, en caché y solo si está en el estado guardado', async ({ page, request }) => {
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
  await expect.poll(async () => (await state(page)).citizens.filter((c: { named: boolean }) => c.named).length, { timeout: 180_000, intervals: [3000] }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(25_000);
  await setSpeed(page, 0);
  await page.goto('about:blank');

  // Una carta en el estado guardado del servidor (como la crearía `postMonth` con correos).
  const require = createRequire(join(process.cwd(), 'packages/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(join(process.cwd(), 'test-results/data/bitopolis.db'));
  const row = db.prepare('SELECT state FROM games WHERE token = ?').get(token) as { state: string };
  const st = JSON.parse(row.state) as GameState;
  expect(st.citizens.some((c) => c.named)).toBe(true);
  const letter = addLetter(st);
  db.prepare('UPDATE games SET state = ? WHERE token = ?').run(JSON.stringify(st), token);
  db.close();

  const first = await (await request.post(`/api/games/${token}/letter/${letter.id}`)).json();
  expect(first.text, JSON.stringify(first)).toContain('te escribo desde lejos');
  expect(first.text).toContain(letter.fromName);
  // Otra vez: la misma (caché, sin otra llamada).
  const again = await (await request.post(`/api/games/${token}/letter/${letter.id}`)).json();
  expect(again).toEqual(first);
  // Una carta que no está en el estado guardado, no.
  expect((await request.post(`/api/games/${token}/letter/${letter.id + 999}`)).status()).toBe(404);
  expect((await request.post(`/api/games/${token}/letter/abc`)).status()).toBe(400);
});
