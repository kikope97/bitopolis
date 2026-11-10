import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { setSpeed, skipTutorial, state, tile } from './helpers.ts';
import { runSimulation } from '../packages/sim/src/index.ts';

/**
 * 2.8 (ronda 24, parte F): el juego con ratón y teclado. Solo en «escritorio» (puntero fino, dpr 1):
 * alejar hasta ver el mapa, tooltip al pasar el ratón en «Mirar», atajos con su chuleta y clic derecho
 * que cancela. Con BITOPOLIS_PERF=1, también los tirones a x10 con el mapa entero a la vista.
 */
let file: Buffer | null = null;
function town() {
  if (!file) {
    const { state: s } = runSimulation({ seed: 4, days: 1430, profile: 'agresivo' });
    file = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: s.formatVersion, exportedAt: '', mode: 'normal', state: s }));
  }
  return file;
}

async function openTown(page: Page, request: import('@playwright/test').APIRequestContext) {
  const r = await request.post('/api/import', { data: town(), headers: { 'content-type': 'application/octet-stream' } });
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
}

const tilePx = (page: Page) => page.evaluate(() => (window as any).__bitopolis.tileCenter(1, 0).x - (window as any).__bitopolis.tileCenter(0, 0).x);

test.describe('escritorio', () => {
  // Solo con ratón (en «movil» el puntero es grueso y no hay nada de esto).
  test.skip(({ isMobile }) => isMobile, 'solo escritorio');

  async function newGame(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Jugar' }).click();
    await skipTutorial(page);
  }
  /** Una casilla vacía (sin edificio ni carretera, en llano) cerca del ayuntamiento. */
  async function emptyNearHall(page: Page) {
    const s = await state(page);
    const hall = s.buildings.find((b: any) => b.kind === 'townhall');
    const busy = (x: number, y: number) => s.buildings.some((b: any) => x >= b.x && x < b.x + (b.size ?? 1) && y >= b.y && y < b.y + (b.size ?? 1));
    for (let d = 2; d < 8; d++) {
      for (const [x, y] of [[hall.x + d, hall.y], [hall.x - d, hall.y], [hall.x, hall.y - d], [hall.x + d, hall.y - d]] as [number, number][]) {
        const i = y * s.map.w + x;
        if (!busy(x, y) && s.map.tiles[i] === 0 && (s.map.terrain?.[i] ?? 0) === 0 && (s.map.zones[i] ?? 0) === 0) return { x, y, hall };
      }
    }
    throw new Error('sin casilla vacía');
  }

  test('con ratón se aleja hasta 16 px por casilla y la rueda acerca hacia el puntero', async ({ page }) => {
    await newGame(page);
    const box = (await page.locator('#map').boundingBox())!;
    // Cada golpe de rueda, un paso (16 px): hasta el mínimo.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const ratio = () =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('#map')!;
        return c.width / c.getBoundingClientRect().width;
      });
    expect(await tilePx(page)).toBe(64);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => tilePx(page)).toBe(32);
    expect(await ratio()).toBeCloseTo(1, 1);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 100);
    await expect.poll(() => tilePx(page)).toBe(16);
    // El paso más lejano pone el lienzo a doble resolución (16 px por casilla sin zoom fraccionario).
    expect(await ratio()).toBeCloseTo(2, 1);
    await expect(page.locator('#map')).toHaveClass(/px-smooth/);
    await page.screenshot({ path: 'test-results/capturas/v28-zoom-lejano.png' });
    // Con 1280×800 cabe el mapa entero a lo ancho.
    const s = await state(page);
    const left = await tile(page, 0, 0);
    const right = await tile(page, s.map.w - 1, 0);
    const box2 = (await page.locator('#map').boundingBox())!;
    expect(left.x).toBeGreaterThanOrEqual(box2.x);
    expect(right.x).toBeLessThanOrEqual(box2.x + box2.width);
    // Acercar con la rueda: la casilla bajo el puntero sigue bajo el puntero.
    const { hall } = await emptyNearHall(page);
    const p = await tile(page, hall.x, hall.y);
    await page.mouse.move(p.x, p.y);
    for (let i = 0; i < 2; i++) await page.mouse.wheel(0, -100);
    await expect.poll(() => tilePx(page)).toBe(64);
    expect(await ratio()).toBeCloseTo(1, 1);
    const q = await tile(page, hall.x, hall.y);
    expect(Math.abs(q.x - p.x)).toBeLessThanOrEqual(32);
    expect(Math.abs(q.y - p.y)).toBeLessThanOrEqual(32);
    // Pasitos del panel táctil: se suman (uno de 20 no cambia nada).
    await page.mouse.wheel(0, 20);
    await page.waitForTimeout(100);
    expect(await tilePx(page)).toBe(64);
  });

  test('en «Mirar», el ratón enseña qué hay: borde, tooltip y mano', async ({ page }) => {
    await newGame(page);
    const { x, y, hall } = await emptyNearHall(page);
    const p = await tile(page, hall.x, hall.y);
    await page.mouse.move(p.x, p.y + 4);
    const tip = page.locator('#hover-tip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Ayuntamiento');
    await expect(page.locator('#map')).toHaveAttribute('data-hover', 'hit');
    expect(await page.locator('#map').evaluate((c) => getComputedStyle(c).cursor)).toBe('pointer');
    await page.screenshot({ path: 'test-results/capturas/v28-tooltip.png' });
    const e = await tile(page, x, y);
    await page.mouse.move(e.x, e.y + 4);
    await expect(tip).toBeHidden();
    await expect(page.locator('#map')).toHaveAttribute('data-hover', 'none');
    // Con una herramienta, nada de tooltip (manda la vista previa).
    await page.mouse.move(p.x, p.y + 4);
    await expect(tip).toBeVisible();
    await page.keyboard.press('2');
    await expect(page.locator('body')).toHaveClass(/tool-active/);
    await page.mouse.move(p.x + 2, p.y + 6);
    await expect(tip).toBeHidden();
  });

  test('clic derecho cancela la obra propuesta y luego la herramienta, sin menú del navegador', async ({ page }) => {
    await newGame(page);
    const { x, y } = await emptyNearHall(page);
    await page.locator('#tab-road').click();
    const e = await tile(page, x, y);
    // Un clic marca el inicio de la carretera; el derecho lo quita.
    await page.mouse.click(e.x, e.y);
    await expect(page.locator('body')).toHaveClass(/placing/);
    await page.mouse.click(e.x, e.y, { button: 'right' });
    await expect(page.locator('body')).not.toHaveClass(/placing/);
    await expect(page.locator('body')).toHaveClass(/tool-active/);
    // Otro clic derecho: vuelve a «Mirar».
    await page.mouse.click(e.x, e.y, { button: 'right' });
    await expect(page.locator('body')).not.toHaveClass(/tool-active/);
    await expect(page.locator('#tab-inspect')).toHaveAttribute('aria-pressed', 'true');
    const prevented = await page.locator('#map').evaluate((c) => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      c.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });

  test('atajos: chuleta, Pueblo, avisos y velocidad; la tecla en los botones y en la bandeja', async ({ page }) => {
    await newGame(page);
    await page.locator('#map').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    const sheetTitle = page.locator('#sheet-title');
    await expect(sheetTitle).toHaveText('Atajos de teclado');
    await expect(page.locator('.kb-row')).not.toHaveCount(0);
    await expect(page.locator('.sheet')).toContainText('Mayús+P');
    await page.screenshot({ path: 'test-results/capturas/v28-chuleta.png' });
    await page.keyboard.press('Escape');
    await expect(sheetTitle).toHaveCount(0);
    await page.keyboard.press('Shift+P');
    await expect(sheetTitle).toHaveText('Pueblo');
    await page.keyboard.press('Shift+A');
    await expect(sheetTitle).toHaveText('Avisos');
    await page.keyboard.press('Shift+A');
    await expect(sheetTitle).toHaveCount(0);
    // Velocidad: Mayús+2 = x3; «<» baja a x1 y luego a pausa; «>» la pone en marcha.
    await page.keyboard.press('Shift+Digit2');
    await expect(page.locator('#speed')).toHaveText('x3');
    await expect(page.locator('#play-pause')).toHaveAttribute('data-paused', 'false');
    await page.keyboard.press('<');
    await expect(page.locator('#speed')).toHaveText('x1');
    await page.keyboard.press('<');
    await expect(page.locator('#play-pause')).toHaveAttribute('data-paused', 'true');
    await page.keyboard.press('>');
    await expect(page.locator('#play-pause')).toHaveAttribute('data-paused', 'false');
    await page.keyboard.press('Space');
    // La tecla, en el title y en la carta de la bandeja.
    await expect(page.locator('#bell')).toHaveAttribute('title', /Mayús\+A/);
    await expect(page.locator('#tab-road')).toHaveAttribute('title', 'Carretera (1)');
    await expect(page.locator('#hud-money')).toHaveAttribute('title', /Caja/);
    await page.locator('#tab-build').click();
    await expect(page.locator('.tray .tool[data-tool="house"] .tool-key')).toBeVisible();
    await expect(page.locator('.tray .tool[data-tool="house"] .tool-key')).toHaveText('2');
    await page.screenshot({ path: 'test-results/capturas/v28-bandeja-teclas.png' });
    await page.keyboard.press('Escape');
    // Sin atajos de una tecla (Ajustes): ni chuleta ni Mayús+P, y los title sin la tecla.
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('bitopolis.prefs') ?? '{}');
      localStorage.setItem('bitopolis.prefs', JSON.stringify({ ...p, shortcuts: false }));
    });
    await page.reload();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await skipTutorial(page);
    await expect(page.locator('#bell')).toHaveAttribute('title', 'Avisos');
    await page.locator('#map').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await page.keyboard.press('Shift+P');
    await page.waitForTimeout(200);
    await expect(sheetTitle).toHaveCount(0);
  });

  test('tirones a x10 con el mapa entero a la vista', async ({ page, request, browserName }) => {
    test.skip(browserName !== 'chromium' || !process.env.BITOPOLIS_PERF);
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openTown(page, request);
    await page.locator('#map').hover();
    await setSpeed(page, 10);
    // Por turnos (32 px, 16 px, 32 px, 16 px): con la máquina cargada, así se comparan en las mismas condiciones.
    const measure = async () => {
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const out = { frames: [] as number[], stop: false };
        (window as any).__tir = out;
        let last = performance.now();
        const loop = (t: number) => {
          out.frames.push(t - last);
          last = t;
          if (!out.stop) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      const end = Date.now() + 5_000;
      while (Date.now() < end) {
        await page.waitForTimeout(400);
        if ((await page.locator('#speed').textContent()) !== 'x10' || (await page.locator('#play-pause').getAttribute('data-paused')) === 'true') {
          if (await page.locator('.sheet-close').count()) await page.locator('.sheet-close').first().click();
          await setSpeed(page, 10);
        }
      }
      const f: number[] = await page.evaluate(() => {
        (window as any).__tir.stop = true;
        return (window as any).__tir.frames;
      });
      const avg = f.reduce((a, b) => a + b, 0) / f.length;
      const sorted = [...f].sort((a, b) => a - b);
      console.log(`1920×1080, ${await tilePx(page)} px por casilla: ${(1000 / avg).toFixed(0)} fps, p95 ${Math.round(sorted[Math.floor(f.length * 0.95)]!)} ms, ${f.filter((x) => x > 50).length} de más de 50 ms`);
      // El mismo objetivo que e2e/tirones (en 5 s): sin tirones visibles.
      expect(Math.max(...f)).toBeLessThan(250);
      expect(f.filter((x) => x > 50).length).toBeLessThanOrEqual(3);
    };
    const wheel = async (n: number) => {
      await page.locator('#map').hover();
      for (let i = 0; i < Math.abs(n); i++) await page.mouse.wheel(0, n > 0 ? 120 : -120);
    };
    await wheel(1);
    await measure();
    await wheel(6);
    await measure();
    await wheel(-1);
    await measure();
    await wheel(1);
    await measure();
  });
});
