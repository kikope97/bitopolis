import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { type GameState, runSimulation } from '../packages/sim/src/index.ts';
import { setSpeed, skipTutorial } from './helpers.ts';

/** 2.3: compartir el pueblo (enlace de solo lectura /v/ y postal PNG). */
function pack(state: GameState) {
  return gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
}

async function importTown(request: import('@playwright/test').APIRequestContext, state: GameState): Promise<string> {
  const { token } = await (await request.post('/api/import', { data: pack(state), headers: { 'content-type': 'application/octet-stream' } })).json();
  return token as string;
}

async function openSettings(page: Page) {
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.locator('.share-section')).toBeVisible();
}

test('2.3: se comparte el pueblo con un enlace de solo lectura y se deja de compartir', async ({ page, browser, request }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 360, height: 780 });
  const shot = (p: Page, n: string) => p.screenshot({ path: `test-results/capturas/${info.project.name}-compartir-${n}.png` });
  const { state } = runSimulation({ seed: 3, days: 400, profile: 'constructor', checkEveryDay: false });
  const token = await importTown(request, state);
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 0);

  await openSettings(page);
  await page.locator('#share-create').click();
  const url = await page.locator('#share-url').inputValue();
  const m = url.match(/\/v\/([0-9A-Za-z]{22})$/);
  expect(m).not.toBeNull();
  const viewToken = m![1]!;
  expect(viewToken).not.toBe(token);
  expect(url).not.toContain(token);
  await expect(page.locator('#share-stop')).toBeVisible();
  for (const id of ['#share-copy', '#share-stop', '#share-postcard']) {
    const box = (await page.locator(id).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(361);
  }
  await page.locator('#share-copy').click();
  await expect(page.locator('#toasts')).toContainText(/Enlace copiado|Mantén pulsado/);
  // Al 200 %: sigue cabiendo en 360 px.
  await page.getByRole('radio', { name: '200 %' }).click();
  await page.locator('.share-section').scrollIntoViewIfNeeded();
  const wide = await page.evaluate(() => document.querySelector('.share-section')!.scrollWidth <= document.querySelector('.share-section')!.clientWidth + 1);
  expect(wide).toBe(true);
  await shot(page, '1-ajustes-200');
  await page.getByRole('radio', { name: '100 %' }).click();

  // La vista, en otro navegador (sin la sesión del alcalde).
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: info.project.name === 'movil' });
  const viewer = await ctx.newPage();
  const verrors: string[] = [];
  viewer.on('pageerror', (e) => verrors.push(e.message));
  const calls: string[] = [];
  const bodies: string[] = [];
  viewer.on('request', (r) => calls.push(`${r.method()} ${new URL(r.url()).pathname}`));
  viewer.on('response', async (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) bodies.push(await r.text().catch(() => ''));
  });
  const res = await viewer.goto(url.replace(/^https?:\/\/[^/]+/, ''));
  expect(res!.headers()['referrer-policy']).toBe('no-referrer');
  await expect(viewer.locator('#view-map')).toBeVisible();
  await expect(viewer.locator('#view-cta')).toHaveText('Haz tu pueblo');
  await expect(viewer.locator('#view-cta')).toHaveAttribute('href', '/');
  await expect.poll(() => viewer.evaluate(() => (window as any).__bitopolisView?.population)).toBe(state.citizens.length);
  expect(await viewer.evaluate(() => (window as any).__bitopolisView.buildings)).toBe(state.buildings.length);
  // Ni barra de arriba ni herramientas, ni worker.
  expect(await viewer.locator('#game').isHidden()).toBe(true);
  expect(await viewer.evaluate(() => (window as any).__bitopolis)).toBeUndefined();
  // Zoom y paneo.
  const z0 = await viewer.evaluate(() => (window as any).__bitopolisView.zoom());
  await viewer.locator('#view-in').click();
  expect(await viewer.evaluate(() => (window as any).__bitopolisView.zoom())).toBeGreaterThan(z0);
  const c0 = await viewer.evaluate(() => (window as any).__bitopolisView.cam());
  const box = (await viewer.locator('#view-map').boundingBox())!;
  await viewer.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await viewer.mouse.down();
  await viewer.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 60, { steps: 5 });
  await viewer.mouse.up();
  expect(await viewer.evaluate(() => (window as any).__bitopolisView.cam())).not.toEqual(c0);
  await shot(viewer, '2-vista-360');
  // Solo lectura: no reclama ni guarda, y no ve el token de juego ni la key.
  expect(calls.filter((c) => c.includes('/api/games/'))).toEqual([]);
  expect(calls.filter((c) => !c.startsWith('GET '))).toEqual([]);
  const html = await viewer.content();
  for (const text of [html, ...bodies]) {
    expect(text).not.toContain(token);
    expect(text).not.toMatch(/"(key|key_enc|rng|seed|ai|pending|decisionLog)"\s*:/);
  }
  expect(await viewer.evaluate(() => JSON.stringify(localStorage))).not.toContain(token);
  // Un token de vista no abre la partida.
  expect((await request.post(`/api/games/${viewToken}/claim`, { data: { sessionId: 'intruso_12345678', force: true } })).status()).toBe(404);
  expect((await request.get(`/api/games/${viewToken}/export`)).status()).toBe(404);

  // Postal: PNG de 1080×1350 (sin Web Share, se descarga).
  await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#share-postcard').click()]);
  const png = readFileSync((await dl.path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(1080);
  expect(png.readUInt32BE(20)).toBe(1350);
  await dl.saveAs(`test-results/capturas/${info.project.name}-compartir-postal.png`);

  // Dejar de compartir: el enlace deja de funcionar.
  await page.locator('#share-stop').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Dejar de compartir' }).click();
  await expect(page.locator('#share-create')).toBeVisible();
  // (El navegador que ya lo abrió puede guardarlo 60 s en caché: `private, max-age=60`.) Uno nuevo ya no lo ve.
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const gone = await ctx2.newPage();
  await gone.goto(`/v/${viewToken}`);
  await expect(gone.getByText('Este enlace ya no funciona')).toBeVisible();
  await expect(gone.getByRole('link', { name: 'Haz tu pueblo' })).toHaveAttribute('href', '/');
  await shot(gone, '3-enlace-revocado');
  expect((await request.get(`/api/view/${viewToken}`)).status()).toBe(404);
  await ctx2.close();
  expect(errors).toEqual([]);
  expect(verrors.filter((e) => !/404/.test(e))).toEqual([]);
});
