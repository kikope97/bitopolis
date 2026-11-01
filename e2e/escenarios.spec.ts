import { expect, test } from '@playwright/test';
import { skipTutorial, state } from './helpers.ts';

/** 2.3: escenario y terreno al empezar (plegados bajo el modo; por defecto, Libre y al azar). */

test('Jugar sin tocar nada: partida libre como siempre (la petición no lleva escenario ni terreno)', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/p\/[0-9A-Za-z]{22}$/);
  const picker = page.locator('details.scenario-picker');
  await expect(picker).toBeVisible();
  await expect(picker).not.toHaveAttribute('open', '');
  await expect(picker.locator('summary')).toContainText('Escenario: Libre');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/games\/[0-9A-Za-z]{22}$/.test(r.url()));
  await page.getByRole('button', { name: 'Jugar' }).click();
  const body = (await sent).postDataJSON();
  expect(body).toEqual({ mode: 'normal', sessionId: expect.any(String) });
  await expect(page.locator('#game')).toBeVisible();
  const s = await state(page);
  expect(s.scenario).toEqual({ id: 'libre', done: true });
  expect(s.citizens).toHaveLength(1);
  expect(s.buildings).toHaveLength(1);
  expect(s.treasury).toBe(30_000);
});

test('elegir escenario y terreno al empezar (a 360 px, con teclado)', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const picker = page.locator('details.scenario-picker');
  await picker.locator('summary').click();
  await expect(picker).toHaveAttribute('open', '');
  const cards = picker.getByRole('radiogroup', { name: 'Escenario' }).getByRole('radio');
  await expect(cards).toHaveCount(4);
  await expect(cards.first()).toHaveAttribute('aria-checked', 'true');
  // Cada tarjeta dice su meta y su plazo.
  await expect(picker.getByRole('radio', { name: /Tras la riada/ })).toContainText('meses');
  await picker.getByRole('radio', { name: /Tras la riada/ }).click();
  await expect(picker.locator('summary')).toContainText('Escenario: Tras la riada');
  await expect(picker).toContainText('siempre tiene río');

  // Terreno: 5 chips de 44 px como mínimo; con las flechas se cambia sin salir del grupo.
  const chips = picker.getByRole('radiogroup', { name: 'Terreno' }).getByRole('radio');
  await expect(chips).toHaveCount(5);
  for (const box of await chips.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await chips.nth(3).click(); // Colinas
  await page.keyboard.press('ArrowRight'); // → Llano
  await expect(chips.nth(4)).toHaveAttribute('aria-checked', 'true');
  await expect(chips.nth(4)).toBeFocused();
  await expect(picker.locator('summary')).toContainText('llano');
  // Nada se sale de la pantalla a 360 px.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-escenarios-360.png`, fullPage: true });

  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/games\/[0-9A-Za-z]{22}$/.test(r.url()));
  await page.getByRole('button', { name: 'Jugar' }).click();
  expect((await sent).postDataJSON()).toMatchObject({ mode: 'normal', scenario: 'riada', terrain: 'llano' });
  await expect(page.locator('#game')).toBeVisible();
  await skipTutorial(page);
  const s = await state(page);
  expect(s.scenario).toMatchObject({ id: 'riada', done: false, goal: { kind: 'reparar' } });
  expect(s.townhallLevel).toBe(2);
  expect(s.buildings.filter((b: { damaged?: { cause?: string } }) => b.damaged?.cause === 'riada')).toHaveLength(6);
  expect(s.grants.some((g: { emergency?: number }) => g.emergency === 20_000)).toBe(true);
  // Llano, pero con el río de la riada: ni mar ni colinas.
  expect(s.map.terrain.includes(1)).toBe(true);
  expect(s.map.terrain.includes(2) || s.map.terrain.includes(3)).toBe(false);
  // La meta se ve en Pueblo › Objetivos.
  await page.locator('#menu').click();
  await expect(page.locator('.scenario-goal')).toContainText('Tras la riada');
  await expect(page.locator('.scenario-goal')).toContainText('Quedan 36 meses');
  await page.screenshot({ path: `test-results/capturas/${info.project.name}-escenarios-meta-360.png` });
});

test('con el texto al 200 % el bloque sigue cabiendo a 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await page.evaluate(() => (document.documentElement.dataset.text = '200'));
  await page.locator('details.scenario-picker summary').click();
  await page.getByRole('radio', { name: /El pueblo que se vacía/ }).click();
  await expect(page.locator('details.scenario-picker summary')).toContainText('El pueblo que se vacía');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
