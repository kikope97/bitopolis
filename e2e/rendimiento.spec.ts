import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { setSpeed, skipTutorial } from './helpers.ts';
import { runSimulation } from '../packages/sim/src/index.ts';

/** Gama media: CPU ×4 más lenta (Chromium). Se mide el render a x3 en un pueblo grande. */
test('rendimiento: fluido con la CPU ×4 más lenta', async ({ page, request, browserName }, info) => {
  // Se mide sola (pnpm perf): en paralelo con el resto de pruebas, la CPU compartida falsea la medida.
  test.skip(browserName !== 'chromium' || !process.env.BITOPOLIS_PERF);
  test.setTimeout(90_000);
  const { state } = runSimulation({ seed: 1, days: 600, profile: 'constructor' });
  const data = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
  const r = await request.post('/api/import', { data, headers: { 'content-type': 'application/octet-stream' } });
  const { token } = await r.json();
  await page.goto(`/p/${token}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  await setSpeed(page, 3);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.waitForTimeout(500);
  const frames: number[] = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out: number[] = [];
        let last = performance.now();
        const t0 = last;
        const loop = (t: number) => {
          out.push(t - last);
          last = t;
          if (t - t0 < 4000) requestAnimationFrame(loop);
          else resolve(out);
        };
        requestAnimationFrame(loop);
      }),
  );
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const sorted = [...frames].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  console.log(`${info.project.name}: ${state.citizens.length} vecinos, ${frames.length} fotogramas, mediana ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  console.log(`  media ${avg.toFixed(1)} ms (${(1000 / avg).toFixed(0)} fps)`);
  // Headless usa render por software: el umbral es la media (≥25 fps) y la mediana (≥30 fps).
  expect(median).toBeLessThan(34);
  expect(avg).toBeLessThan(40);
});
