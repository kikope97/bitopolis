import { expect, test } from '@playwright/test';
import { state, tap } from './helpers.ts';

test('Modo IA: configurar, jugar y ver un motivo de la IA', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('radio', { name: /Modo IA/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Configurar la IA');
  await expect(page.getByRole('dialog')).toContainText('Se acepta API key de Anthropic (sk-ant-…) o de OpenAI (sk-…)');
  await page.locator('#ai-key').fill('sk-ant-prueba-123456');
  await expect(page.getByRole('dialog')).toContainText('Detectada: Anthropic');
  await page.locator('#ai-key').fill('');
  // En el test se usa un LLM falso local (endpoint propio, compatible con OpenAI).
  await page.locator('details.advanced summary').first().click();
  await page.locator('#ai-base').fill('http://localhost:8099/v1');
  await page.locator('#ai-model').fill('falso');
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-ia-config.png` });
  await page.getByRole('button', { name: 'Guardar y usar el Modo IA' }).click();
  await expect(page.locator('.toast').last()).toContainText('casilla');
  await page.locator('#ai-accept').check();
  await page.getByRole('button', { name: 'Guardar y usar el Modo IA' }).click();
  await expect(page.locator('.stats-card')).toContainText('Modo IA');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#game')).toBeVisible();
  await page.locator('.tut-box button').click();

  const s0 = await state(page);
  expect(s0.aiMode).toBe(true);
  const cx = s0.map.w / 2;
  const cy = s0.map.h / 2;
  await page.locator('[data-tool="house"]').click();
  await tap(page, cx + 2, cy + 1);
  await page.locator('[data-speed="3"]').click();
  // La primera decisión (opinión o llegada) debe venir de la IA.
  await expect(page.locator('.bubble .ai-badge').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.bubble').first()).toContainText('promete');
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-ia-burbuja.png` });
  await expect(page.locator('#ai-chip')).toHaveText('IA ●');
  const s1 = await state(page);
  expect(s1.decisionLog.some((d: { source: string }) => d.source === 'ai')).toBe(true);

  await page.locator('[data-speed="0"]').click();
  // Consejero con IA (modelo premium) en Modo IA.
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Consejero' }).click();
  await page.getByRole('button', { name: '¿Cómo va el pueblo?' }).click();
  await expect(page.locator('.advice')).toContainText('alcalde', { timeout: 10_000 });
  await expect(page.locator('.advice .ai-badge')).toBeVisible();
  await page.locator('.sheet-close').click();
  await page.locator('#menu').click();
  await page.getByRole('button', { name: 'Gasto de la IA' }).click();
  await expect(page.locator('.sheet')).toContainText('las tomó la IA');
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-ia-gasto.png` });
  expect(errors).toEqual([]);
});
