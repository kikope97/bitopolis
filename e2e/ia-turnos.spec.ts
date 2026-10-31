import { expect, test } from '@playwright/test';
import { pickTool, setSpeed, skipTutorial, state, tap } from './helpers.ts';

/** 2.0: el pueblo decide por turnos con la IA (LLM falso en 8099). */
test('2.0: un turno del pueblo con IA llega, se aplica y se ve en «Qué está pasando»', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('radio', { name: /Modo IA/ }).click();
  await page.locator('details.advanced summary').first().click();
  await page.locator('#ai-base').fill('http://localhost:8099/v1');
  await page.getByRole('button', { name: 'Cargar modelos' }).click();
  await page.locator('#ai-model-list').selectOption('falso-mini');
  await page.locator('#ai-accept').check();
  await page.getByRole('button', { name: 'Guardar y usar el Modo IA' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  const s0 = await state(page);
  const cx = s0.map.w / 2;
  const cy = s0.map.h / 2;
  // Casas, agua y luz para que lleguen vecinos.
  await pickTool(page, 'house');
  await tap(page, cx + 2, cy + 1);
  await tap(page, cx - 2, cy + 1);
  await setSpeed(page, 3);
  // Llega el primer turno de la IA (a la semana de juego).
  await expect
    .poll(
      async () => {
        const st = await state(page);
        if (process.env.DEBUG_TURNS) console.log(st.tick, st.formatVersion, st.aiMode, 'ai' in st, st.citizens.length, st.citizens.filter((c: { named: boolean }) => c.named).length, JSON.stringify({ turn: st.ai?.turn, lastN: st.ai?.lastN, next: st.ai?.next, log: st.ai?.log.map((l: { n: number; source: string }) => `${l.n}:${l.source}`) }));
        return (st.ai?.log ?? []).filter((l: { source: string }) => l.source === 'ia').length;
      },
      { timeout: 180_000, intervals: [3000] },
    )
    .toBeGreaterThan(0);
  const s1 = await state(page);
  console.log(JSON.stringify(s1.ai.log.at(-1)).slice(0, 800));
  await setSpeed(page, 0);
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Qué está pasando/ }).click();
  await expect(page.locator('.sheet')).toContainText('✦ IA');
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-ia-turno.png` });
  expect(errors).toEqual([]);
});
