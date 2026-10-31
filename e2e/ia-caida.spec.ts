import { expect, test } from '@playwright/test';
import { pickTool, setSpeed, skipTutorial, state, tap } from './helpers.ts';

/** 2.0: si la IA no responde (endpoint caído), el pueblo sigue: esa semana deciden las reglas. */
test('2.0: con la IA caída el juego no se para y el turno sale «por costumbre»', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('radio', { name: /Modo IA/ }).click();
  await page.locator('details.advanced summary').first().click();
  // Nadie escucha en este puerto.
  await page.locator('#ai-base').fill('http://localhost:8097/v1');
  await page.locator('#ai-accept').check();
  await page.getByRole('button', { name: 'Guardar y usar el Modo IA' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await skipTutorial(page);
  const s0 = await state(page);
  await pickTool(page, 'house');
  await tap(page, s0.map.w / 2 + 2, s0.map.h / 2 + 1);
  await tap(page, s0.map.w / 2 - 2, s0.map.h / 2 + 1);
  await setSpeed(page, 3);
  // Pasan dos turnos (dos semanas a x1, o el ritmo que toque) y el reloj no se queda parado.
  await expect
    .poll(async () => ((await state(page)).ai?.log ?? []).filter((l: { source: string }) => l.source === 'reglas').length, { timeout: 200_000, intervals: [3000] })
    .toBeGreaterThan(1);
  const s1 = await state(page);
  expect(s1.ai.log.some((l: { source: string }) => l.source === 'ia')).toBe(false);
  expect(s1.tick).toBeGreaterThan(s1.ai.log.at(-1).n > 0 ? 24 * 7 : 0);
  await setSpeed(page, 0);
  await page.locator('#menu').click();
  await page.getByRole('button', { name: /Qué está pasando/ }).click();
  await expect(page.locator('.sheet')).toContainText('por costumbre');
  expect(errors).toEqual([]);
});
