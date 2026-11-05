import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, runSimulation } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial } from './helpers.ts';

const TICKS_PER_DAY = 24;

/**
 * 2.7: campana 2.0 (guardada por partida, «Te piden» y «Ha pasado») y
 * «Hoy en Bitópolis» al volver (sustituye a «Mientras no estabas»).
 * Capturas en test-results/capturas/campana-*.
 */
let base: GameState | null = null;
function town(): GameState {
  if (!base) base = runSimulation({ seed: 42, days: 400, profile: 'constructor', checkEveryDay: false }).state;
  const s = structuredClone(base);
  for (const b of s.buildings) {
    delete b.fire;
    delete b.risk;
  }
  // Una subvención por responder (con plazo): sale en «Te piden».
  s.grants.push({ id: s.nextId++, kind: 'library', share: 0.5, offeredTick: s.tick, deadline: s.tick + 200 * TICKS_PER_DAY, status: 'offered', advance: 0, minId: s.nextId, offerDays: 20 });
  s.weather = { kind: 'sol', until: s.tick + 30 * TICKS_PER_DAY };
  return s;
}

async function importTown(request: import('@playwright/test').APIRequestContext, s: GameState): Promise<string> {
  const data = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
  const { token } = await (await request.post('/api/import', { data, headers: { 'content-type': 'application/octet-stream' } })).json();
  return token as string;
}

async function enter(page: Page, token: string) {
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

for (const size of [
  { name: '360', w: 360, h: 740 },
  { name: '390', w: 390, h: 844 },
]) {
  test(`2.7: la campana sobrevive a recargar y «Te piden» separa lo pendiente (${size.name})`, async ({ page, request }, info) => {
    test.skip(info.project.name !== 'escritorio', 'el tamaño lo pone la propia prueba');
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: size.w, height: size.h });
    const token = await importTown(request, town());
    await enter(page, token);
    await setSpeed(page, 0);
    // La campana cuenta lo que te piden (la subvención) y lo dice.
    await expect(page.locator('#bell')).toHaveAttribute('aria-label', /Avisos: \d+ sin leer \(\d+ te piden? respuesta\)/);
    await expect(page.locator('#bell .bell-n')).toBeVisible();

    // Un aviso de esta visita (x10 avisa una vez) queda en «Ha pasado».
    await setSpeed(page, 10);
    await setSpeed(page, 0);
    await expect(page.locator('#toasts')).toContainText('x10 avanza un mes');
    await page.waitForTimeout(400);

    // Recargar: la campana sigue ahí.
    await page.reload();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await skipTutorial(page);
    await setSpeed(page, 0);
    await page.locator('#bell').click();
    await expect(page.locator('#sheet-title')).toHaveText('Avisos');
    // Se abre por «Te piden» (hay algo pendiente), con plazo y botón.
    await expect(page.locator('#log-tab-asks')).toHaveAttribute('aria-selected', 'true');
    const ask = page.locator('#log-asks .ask-card[data-ask^="grant:"]');
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('una biblioteca');
    await expect(ask.locator('.ask-due')).toContainText(/quedan \d+ días/);
    await expect(page.locator('#log-asks')).not.toContainText('x10 avanza');
    await page.screenshot({ path: `test-results/capturas/campana-${size.name}-te-piden.png` });
    // «Ha pasado» guarda lo de antes de recargar.
    await page.locator('#log-tab-past').click();
    await expect(page.locator('#log-past')).toBeVisible();
    await expect(page.locator('#log-past')).toContainText('x10 avanza un mes');
    await page.screenshot({ path: `test-results/capturas/campana-${size.name}-ha-pasado.png` });
    // Nada se sale por el lado.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    // «Responder» abre la tarjeta de la subvención (Aceptar/Rechazar a la vista).
    await page.locator('#log-tab-asks').click();
    await ask.getByRole('button', { name: 'Responder' }).click();
    await expect(page.locator('#th-grants')).toBeVisible();
    await expect(page.locator('.sheet').getByRole('button', { name: 'Aceptar' }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const text of [100, 200] as const) {
  test(`2.7: «Hoy en Bitópolis» al volver y «▶ Seguir» reanuda (texto ${text} %)`, async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (info.project.name === 'escritorio') await page.setViewportSize({ width: 390, height: 844 });
    const s = town();
    const token = await importTown(request, s);
    // La última visita fue hace un rato (hora real 0) y 30 días de juego antes, con 3 vecinos menos; iba a x3.
    const seen = { tick: s.tick - 30 * TICKS_PER_DAY, pop: s.citizens.length - 3, treasury: s.treasury - 1500, at: 0, rank: s.rank?.level ?? 0 };
    await page.addInitScript(
      ([t, v, size]) => {
        if (sessionStorage.getItem('hoy-test')) return;
        sessionStorage.setItem('hoy-test', '1');
        localStorage.setItem(`bitopolis.seen.${t}`, v as string);
        localStorage.setItem(`bitopolis.speed.${t}`, '3');
        localStorage.setItem('bitopolis.prefs', JSON.stringify({ text: size }));
      },
      [token, JSON.stringify(seen), text] as const,
    );
    await enter(page, token);
    const hoy = page.locator('.hoy');
    await expect(hoy).toBeVisible();
    await expect(hoy.locator('#hoy-title')).toHaveText('Hoy en Bitópolis');
    // Una frase con cifras reales, lo que ha cambiado, lo que te piden y la cara del día.
    await expect(hoy.locator('.hoy-line')).toContainText(`${s.citizens.length}`);
    await expect(hoy.locator('.hoy-line')).toContainText('+3 vecinos');
    await expect(hoy.locator('.hoy-ask[data-ask^="grant:"]')).toContainText(/quedan \d+ días/);
    await expect(hoy.locator('.hoy-face canvas')).toBeVisible();
    // Mientras está abierta, el juego espera en pausa.
    await expect(page.locator('#play-pause')).toHaveAttribute('data-paused', 'true');
    const over = await hoy.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/capturas/campana-hoy-${info.project.name}-${text}.png` });
    // «▶ Seguir» cierra y reanuda a la velocidad guardada.
    const go = hoy.getByRole('button', { name: '▶ Seguir a x3' });
    await expect(go).toBeVisible();
    await go.click();
    await expect(hoy).toHaveCount(0);
    await expect(page.locator('#play-pause')).toHaveAttribute('data-paused', 'false');
    await expect(page.locator('#speed')).toHaveText('x3');
    await setSpeed(page, 0);

    // Al recargar en seguida no vuelve a salir.
    await page.reload();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await skipTutorial(page);
    await page.waitForTimeout(500);
    await expect(page.locator('.hoy')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('2.7: tocar lo que te piden en «Hoy» abre su tarjeta', async ({ page, request }) => {
  test.setTimeout(90_000);
  const s = town();
  const token = await importTown(request, s);
  const seen = { tick: s.tick, pop: s.citizens.length, treasury: s.treasury, at: 0, rank: s.rank?.level ?? 0 };
  await page.addInitScript(([t, v]) => localStorage.setItem(`bitopolis.seen.${t}`, v as string), [token, JSON.stringify(seen)] as const);
  await enter(page, token);
  // Sin cambios, pero con algo pendiente: sale igual (y solo con eso).
  await expect(page.locator('.hoy')).toBeVisible();
  await expect(page.locator('.hoy-since')).toHaveCount(0);
  await page.locator('.hoy-ask[data-ask^="grant:"]').click();
  await expect(page.locator('.hoy')).toHaveCount(0);
  await expect(page.locator('#th-grants')).toBeVisible();
});

test('2.7: sin nada que contar no sale «Hoy»', async ({ page, request }) => {
  const { state: s } = runSimulation({ seed: 5, days: 60, profile: 'casual' });
  const token = await importTown(request, s);
  const seen = { tick: s.tick, pop: s.citizens.length, treasury: s.treasury, at: 0, rank: s.rank?.level ?? 0 };
  await page.addInitScript(([t, v]) => localStorage.setItem(`bitopolis.seen.${t}`, v as string), [token, JSON.stringify(seen)] as const);
  await enter(page, token);
  await page.waitForTimeout(800);
  await expect(page.locator('.hoy')).toHaveCount(0);
});
