import { expect, test } from '@playwright/test';

/** La letra pixel en la partida, al 100 % y al 200 % (solo tamaños de píxel exacto). */
for (const size of ['100', '200'] as const) {
  test(`fuente pixel en la partida al ${size} %`, async ({ page }, info) => {
    await page.addInitScript((t) => localStorage.setItem('bitopolis.prefs', JSON.stringify({ font: 'pixel', text: Number(t) })), size);
    await page.goto('/');
    await page.getByRole('button', { name: 'Jugar' }).click();
    await page.locator('.tut-box button').click();
    await page.locator('#menu').click();
    await page.getByRole('button', { name: /Ajustes/ }).click();
    // Todo el texto mide 22/33 px (1rem) o la mitad: nada de tamaños intermedios.
    const sizes = await page.evaluate(() => {
      const out = new Set<string>();
      for (const el of document.querySelectorAll('body *')) {
        if (!(el as HTMLElement).innerText?.trim() || (el as HTMLElement).offsetParent === null) continue;
        out.add(getComputedStyle(el).fontSize);
      }
      return [...out];
    });
    const base = size === '100' ? 22 : 33;
    for (const s of sizes) expect([base, base / 2, base * 3].map((n) => `${n}px`)).toContain(s);
    await page.screenshot({ path: `test-results/capturas/${info.project.name}-v11-pixel-${size}.png` });
  });
}
