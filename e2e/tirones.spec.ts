import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { setSpeed, skipTutorial } from './helpers.ts';
import { runSimulation } from '../packages/sim/src/index.ts';

/**
 * 2.5.1: tirones a x10 en un pueblo de ~77 vecinos (el de e2e/elecciones-listas). Cuenta los
 * fotogramas de más de 50 ms durante 10 s; con BITOPOLIS_LOAF=1, qué script se llevó cada fotograma
 * largo, y con BITOPOLIS_PROFILE=1, el perfil de CPU del hilo principal (para nombres legibles,
 * compila sin minificar). Se mide sola: `pnpm perf`.
 */
const SIZES = [
  { width: 412, height: 915 },
  { width: 768, height: 1024 },
];

let file: Buffer | null = null;
function town() {
  if (!file) {
    const { state } = runSimulation({ seed: 1, days: 1430, profile: 'agresivo' });
    file = gzipSync(JSON.stringify({ bitopolis: 1, formatVersion: state.formatVersion, exportedAt: '', mode: 'normal', state }));
  }
  return file;
}

for (const size of SIZES) {
  test(`tirones a x10: ${size.width}×${size.height}`, async ({ page, request, browserName }, info) => {
    test.skip(browserName !== 'chromium' || !process.env.BITOPOLIS_PERF || info.project.name !== 'movil');
    test.setTimeout(150_000);
    await page.setViewportSize(size);
    const r = await request.post('/api/import', { data: town(), headers: { 'content-type': 'application/octet-stream' } });
    const { token } = await r.json();
    await page.goto(`/p/${token}`);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await skipTutorial(page);
    await setSpeed(page, 10);
    await page.waitForTimeout(1500);
    const cdp = await page.context().newCDPSession(page);
    const profile = !!process.env.BITOPOLIS_PROFILE;
    if (profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    await page.evaluate(() => {
      const out = { frames: [] as number[], long: [] as number[], loaf: [] as string[], stop: false };
      (window as any).__tirones = out;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => out.long.push(Math.round(e.duration)))).observe({ type: 'longtask' });
      // Qué script se llevó cada fotograma largo (Long Animation Frames, Chromium).
      try {
        new PerformanceObserver((l) =>
          l.getEntries().forEach((e: any) => {
            if (e.duration < 50) return;
            const scripts = (e.scripts ?? []).map((x: any) => `${x.invoker || x.invokerType}:${x.sourceFunctionName || '?'}@${Math.round(x.duration)}ms(forced ${Math.round(x.forcedStyleAndLayoutDuration)})`);
            out.loaf.push(`${Math.round(e.duration)}ms render ${Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0)}ms style ${Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0)}ms: ${scripts.join(' | ')}`);
          }),
        ).observe({ type: 'long-animation-frame' });
      } catch {
        /* sin LoAF */
      }
      let last = performance.now();
      const loop = (t: number) => {
        out.frames.push(t - last);
        last = t;
        if (!out.stop) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    // 10 s a x10: si un aviso importante baja la velocidad (attention), se vuelve a x10.
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      await page.waitForTimeout(400);
      if ((await page.locator('#speed').textContent()) !== 'x10' || (await page.locator('#play-pause').getAttribute('data-paused')) === 'true') {
        if (await page.locator('.sheet-close').count()) await page.locator('.sheet-close').first().click();
        await setSpeed(page, 10);
      }
    }
    const res: { frames: number[]; long: number[]; loaf: string[] } = await page.evaluate(() => {
      const out = (window as any).__tirones;
      out.stop = true;
      return { frames: out.frames, long: out.long, loaf: out.loaf };
    });
    if (process.env.BITOPOLIS_LOAF) console.log(res.loaf.join('\n'));
    const speed = await page.locator('#speed').textContent();
    if (profile) {
      const { profile: p } = await cdp.send('Profiler.stop');
      const self = new Map<string, number>();
      const byId = new Map(p.nodes.map((n) => [n.id, n]));
      const dt = p.timeDeltas ?? [];
      p.samples?.forEach((id, i) => {
        const n = byId.get(id)!;
        const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
        self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
      });
      // Tiempo total (con lo que llama) por función: suma de las muestras con esa función en la pila.
      const parent = new Map<number, number>();
      for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
      const incl = new Map<string, number>();
      p.samples?.forEach((id, i) => {
        const seen = new Set<string>();
        for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
          const n = byId.get(cur)!;
          const k = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber}`;
          if (seen.has(k)) continue;
          seen.add(k);
          incl.set(k, (incl.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
        }
      });
      console.log('--- total');
      console.log([...incl.entries()].filter(([k]) => !k.startsWith('(')).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`).join('\n'));
      console.log('--- propio');
      const top = [...self.entries()].filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)')).sort((a, b) => b[1] - a[1]).slice(0, 25);
      console.log(top.map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`).join('\n'));
    }
    const f = res.frames;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    const over = f.filter((x) => x > 50);
    console.log(
      `${size.width}×${size.height} (${speed}): ${f.length} fotogramas, ${(1000 / avg).toFixed(0)} fps de media, ${over.length} de más de 50 ms [${over.map((x) => Math.round(x)).join(', ')}], máx ${Math.round(Math.max(...f))} ms; tareas largas: [${res.long.join(', ')}]`,
    );
    // Objetivo: sin tirones visibles (ningún fotograma de más de 250 ms y como mucho 3 de más de 50 en 10 s).
    expect(Math.max(...f)).toBeLessThan(250);
    expect(over.length).toBeLessThanOrEqual(3);
  });
}
