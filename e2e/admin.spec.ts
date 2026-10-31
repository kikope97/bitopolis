import { expect, test } from '@playwright/test';

/**
 * Panel /admin (v1.2). Usa su propio servidor (puerto 8091, ver
 * playwright.config.ts) porque cambia ajustes globales: contraseña para jugar,
 * partidas nuevas, IA del servidor.
 */
const ADMIN = 'http://localhost:8091';
// Sin reintentos: el primer intento ya cambia la cuenta y un reintento no puede repetirlo.
test.describe.configure({ mode: 'serial', retries: 0 });

test('admin: primer acceso, ajustes que valen al momento y vista móvil', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'escritorio', 'un solo proyecto: los ajustes son globales');
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n: string) => page.screenshot({ path: `test-results/capturas/admin-${n}.png`, fullPage: true });

  // Primer acceso: admin / admin y cambio obligatorio.
  await page.goto(`${ADMIN}/admin`);
  await page.getByLabel('Usuario').fill('admin');
  await page.getByLabel('Contraseña').fill('admin');
  await shot('1-entrar');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Cambia la contraseña' })).toBeVisible();
  // Sin cambiarla, la API no deja configurar nada.
  expect((await page.request.get(`${ADMIN}/api/admin/settings`)).status()).toBe(403);
  await page.getByLabel('Usuario').fill('alcalde');
  await page.getByLabel('Contraseña nueva', { exact: true }).fill('plaza-mayor-1');
  await page.getByLabel('Repite la contraseña nueva').fill('otra-distinta');
  await page.getByRole('button', { name: 'Guardar y entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('no coinciden');
  await expect(page.getByLabel('Repite la contraseña nueva')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Repite la contraseña nueva')).toBeFocused();
  await page.getByLabel('Repite la contraseña nueva').fill('plaza-mayor-1');
  await page.getByRole('button', { name: 'Guardar y entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeFocused();
  await shot('2-panel');

  const acceso = page.getByRole('region', { name: 'Partidas y acceso' });
  /** Pulsa y espera a que el servidor haya guardado (los avisos anteriores pueden seguir en pantalla). */
  const saved = async (button: ReturnType<typeof page.getByRole>) => {
    const done = page.waitForResponse((r) => r.url().endsWith('/api/admin/settings') && r.request().method() === 'PUT' && r.ok());
    await button.click();
    await done;
  };

  // Enlace para invitar (la raíz, no el de una partida).
  await expect(acceso.locator('.invite .mono')).toHaveText(`${ADMIN}/`);
  // Sin la casilla, la contraseña para jugar no se puede escribir.
  await expect(acceso.getByRole('textbox', { name: 'Contraseña para jugar' })).toBeDisabled();

  // Avisos compactos: el mismo aviso dos veces se agrupa con un contador.
  await saved(acceso.getByRole('button', { name: 'Guardar acceso' }));
  await saved(acceso.getByRole('button', { name: 'Guardar acceso' }));
  await expect(page.locator('.toast', { hasText: 'Guardado' })).toHaveCount(1);
  await expect(page.locator('.toast .toast-count')).toHaveText(/×\d/);

  // Partidas nuevas desactivadas: el enlace nuevo no lleva a ninguna partida.
  await acceso.getByLabel('Permitir partidas nuevas').uncheck();
  await saved(acceso.getByRole('button', { name: 'Guardar acceso' }));
  const visitor = await browser.newPage();
  await visitor.goto(`${ADMIN}/`);
  await expect(visitor.locator('.notice.closed')).toContainText('no se pueden empezar partidas nuevas');
  await expect(visitor.getByRole('button', { name: 'Jugar' })).toBeHidden();
  await acceso.getByLabel('Permitir partidas nuevas').check();
  await acceso.getByLabel('URL pública').fill('https://bitopolis.example.com');
  await saved(acceso.getByRole('button', { name: 'Guardar acceso' }));
  await visitor.reload();
  await expect(visitor.getByRole('button', { name: 'Jugar' })).toBeVisible();
  await expect(visitor.locator('#link-text')).toContainText('https://bitopolis.example.com/p/');

  // Contraseña para jugar: se activa sin reiniciar y el panel sigue accesible.
  await acceso.getByLabel('URL pública').fill('');
  await acceso.getByLabel('Pedir contraseña para jugar').check();
  await acceso.getByRole('textbox', { name: 'Contraseña para jugar' }).fill('amigos');
  await saved(acceso.getByRole('button', { name: 'Guardar acceso' }));
  const friend = await (await browser.newContext()).newPage();
  await friend.goto(`${ADMIN}/`);
  await expect(friend).toHaveURL(/\/login\.html/);
  await expect(friend.locator('#login-why')).toContainText('Pide la contraseña');
  await friend.getByLabel('Contraseña').fill('amigos');
  await friend.getByRole('button', { name: 'Entrar' }).click();
  await expect(friend).toHaveURL(/\/p\/[0-9A-Za-z]{22}$/);
  await friend.getByRole('button', { name: 'Jugar' }).click();
  await expect(friend.locator('#game')).toBeVisible();
  await acceso.getByLabel('Pedir contraseña para jugar').uncheck();
  await saved(acceso.getByRole('button', { name: 'Guardar acceso' }));

  // IA del servidor: un endpoint propio (el LLM falso) y probar la conexión.
  const ia = page.getByRole('region', { name: 'IA' });
  await ia.getByText('Avanzado: endpoint propio y precios').click();
  await ia.getByLabel('Endpoint propio (Ollama, LM Studio…)').fill('http://localhost:8099/v1');
  await ia.getByLabel('Vecinos con IA por partida (1–20)').fill('6');
  await ia.getByLabel('Servidor al mes').fill('5');
  await saved(ia.getByRole('button', { name: 'Guardar la IA' }));
  await expect(page.locator('.server-ai')).toContainText('Endpoint propio');
  await page.getByRole('button', { name: 'Guardar y probar' }).click();
  await expect(page.locator('.toast').last()).toContainText('Funciona');
  await visitor.goto(`${ADMIN}/`);
  await expect(visitor.getByText('Configurada por el servidor')).toBeVisible();
  await expect(visitor.getByRole('radio', { name: /Modo normal/ })).toHaveCount(0);
  await shot('3-ia');
  await page.getByRole('region', { name: 'IA' }).getByText('Avanzado: endpoint propio y precios').click();
  await page.getByRole('region', { name: 'IA' }).getByLabel('Endpoint propio (Ollama, LM Studio…)').fill('');
  await page.getByRole('region', { name: 'IA' }).getByRole('button', { name: 'Guardar la IA' }).click();
  await expect(page.locator('.server-ai')).toContainText('Sin IA del servidor');

  // Partidas y copias.
  await page.reload();
  // Partidas, copias y cuenta empiezan plegadas (v1.3).
  await page.getByRole('button', { name: 'Partidas', exact: true }).click();
  // Sin copias recientes, «Copias de seguridad» ya viene abierta (ronda 09).
  if ((await page.getByRole('button', { name: 'Copias de seguridad' }).getAttribute('aria-expanded')) !== 'true') await page.getByRole('button', { name: 'Copias de seguridad' }).click();
  const partidas = page.getByRole('region', { name: 'Partidas', exact: true });
  await expect(partidas.locator('li')).not.toHaveCount(0);
  const before = await partidas.locator('li').count();
  await partidas.getByRole('button', { name: 'Borrar' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Borrar' }).click();
  await expect(partidas.locator('li')).toHaveCount(before - 1);
  await expect(partidas.getByRole('heading', { name: 'Partidas' }).or(partidas.getByRole('button', { name: 'Borrar' }).first())).toBeFocused();
  const copias = page.getByRole('region', { name: 'Copias de seguridad' });
  await copias.getByRole('button', { name: 'Hacer una copia ahora' }).click();
  await expect(copias.getByRole('link', { name: 'Descargar' }).first()).toBeVisible();

  // Móvil: sin desbordes horizontales.
  await page.setViewportSize({ width: 320, height: 720 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot('4-movil');

  // Salir: vuelve a pedir la cuenta nueva (admin/admin ya no vale).
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar como administrador' })).toBeVisible();
  await page.getByLabel('Usuario').fill('admin');
  await page.getByLabel('Contraseña').fill('admin');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrectos');
  await page.getByLabel('Usuario').fill('alcalde');
  await page.getByLabel('Contraseña').fill('plaza-mayor-1');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  expect(errors).toEqual([]);
});
