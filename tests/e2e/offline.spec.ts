import { expect, test, type Browser, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@tienda.test';
const CONTRASENA = process.env.E2E_PASSWORD ?? 'contrasena-segura-1';

async function nuevoDispositivo(browser: Browser): Promise<Page> {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  await pagina.goto('/');
  await pagina.getByLabel('Correo').fill(EMAIL);
  await pagina.getByLabel('Contraseña').fill(CONTRASENA);
  await pagina.getByRole('button', { name: 'Entrar' }).click();
  await expect(pagina.getByRole('heading', { name: 'Productos' })).toBeVisible();
  // Espera a que el service worker controle la página (necesario para funcionar offline)
  await pagina
    .waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 10_000 })
    .catch(async () => {
      await pagina.reload();
      await pagina.waitForFunction(() => navigator.serviceWorker?.controller != null);
    });
  await expect(pagina.getByTestId('estado-sync')).toContainText('Sincronizado');
  return pagina;
}

function tarjeta(p: Page, nombre: string) {
  return p.getByRole('listitem').filter({ hasText: nombre });
}

async function irA(p: Page, enlace: string) {
  await p.getByRole('link', { name: enlace, exact: true }).first().click();
}

test('login incorrecto muestra error', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Correo').fill(EMAIL);
  await page.getByLabel('Contraseña').fill('mala-contrasena');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrectos');
});

test('alta de producto sin conexión y sincronización al reconectar', async ({ browser }) => {
  const nombre = `Vestido E2E ${Date.now()}`;
  const a = await nuevoDispositivo(browser);

  await a.context().setOffline(true);
  await a.reload(); // la app debe abrir sin red desde el service worker
  await expect(a.getByRole('heading', { name: 'Productos' })).toBeVisible();

  await irA(a, 'Nuevo');
  await a.getByLabel('Nombre *').fill(nombre);
  await a.getByLabel('Precio (RD$)').fill('1500');
  await a.getByLabel('Cantidad inicial').fill('10');
  await a.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(a.getByRole('heading', { name: nombre })).toBeVisible();
  await expect(a.getByTestId('codigo-lote').first()).toHaveText(/^\d{8}-[A-Z2-9]{4}$/);
  await expect(a.getByTestId('estado-sync')).toContainText('Sin conexión · 3 cambios pendientes');

  await a.context().setOffline(false);
  await expect(a.getByTestId('estado-sync')).toContainText('Sincronizado', { timeout: 20_000 });

  // Otro dispositivo lo ve
  const b = await nuevoDispositivo(browser);
  await b.getByLabel('Buscar productos').fill(nombre);
  await expect(tarjeta(b, nombre)).toBeVisible();
  await expect(tarjeta(b, nombre).getByText('10 en stock')).toBeVisible();
});

test('dos dispositivos venden sin conexión del mismo lote y el stock final es correcto', async ({
  browser,
}) => {
  const nombre = `Bolso E2E ${Date.now()}`;
  const a = await nuevoDispositivo(browser);
  await irA(a, 'Nuevo');
  await a.getByLabel('Nombre *').fill(nombre);
  await a.getByLabel('Cantidad inicial').fill('10');
  await a.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(a.getByRole('heading', { name: nombre })).toBeVisible();
  await expect(a.getByTestId('estado-sync')).toContainText('Sincronizado', { timeout: 20_000 });

  const b = await nuevoDispositivo(browser);
  await b.getByLabel('Buscar productos').fill(nombre);
  await expect(tarjeta(b, nombre).getByText('10 en stock')).toBeVisible();

  async function venderOffline(p: Page, cantidad: number) {
    await p.context().setOffline(true);
    await irA(p, 'Productos');
    await p.getByLabel('Buscar productos').fill(nombre);
    await tarjeta(p, nombre).getByRole('link', { name: 'Vender' }).click();
    await p.getByLabel('Cantidad').fill(String(cantidad));
    await p.getByRole('button', { name: 'Registrar venta' }).click();
    await expect(p.getByRole('status')).toContainText('Venta registrada');
  }
  await venderOffline(a, 3);
  await venderOffline(b, 4);

  for (const p of [a, b]) await p.context().setOffline(false);
  for (const p of [a, b]) {
    await expect(p.getByTestId('estado-sync')).toContainText('Sincronizado', { timeout: 20_000 });
  }
  // Una segunda vuelta para que cada uno reciba las ventas del otro
  for (const p of [a, b]) {
    await p.getByTestId('estado-sync').click();
    await expect(p.getByTestId('estado-sync')).toContainText('Sincronizado', { timeout: 20_000 });
    await irA(p, 'Productos');
    await p.getByLabel('Buscar productos').fill(nombre);
    await expect(tarjeta(p, nombre).getByText('3 en stock')).toBeVisible();
  }
});

test('una foto tomada sin conexión se ve en local y se sube al reconectar', async ({ browser }) => {
  const nombre = `Gorra foto ${Date.now()}`;
  const a = await nuevoDispositivo(browser);
  await a.context().setOffline(true);
  await irA(a, 'Nuevo');
  await a.getByLabel('Nombre *').fill(nombre);
  await a.locator('input[type=file]').last().setInputFiles('public/iconos/icono-512.png');
  await expect(a.getByAltText('Vista previa')).toBeVisible();
  await a.getByRole('button', { name: 'Guardar producto' }).click();
  const img = a.getByRole('img', { name: nombre });
  await expect(img).toHaveAttribute('src', /^blob:/);
  await a.context().setOffline(false);
  await expect(a.getByTestId('estado-sync')).toContainText('Sincronizado', { timeout: 20_000 });
  await expect(img).toHaveAttribute('src', /^\/api\/imagenes\//);

  const b = await nuevoDispositivo(browser);
  await b.getByLabel('Buscar productos').fill(nombre);
  const remota = tarjeta(b, nombre).getByRole('img', { name: nombre });
  await expect(remota).toHaveAttribute('src', /^\/api\/imagenes\//);
  await expect
    .poll(() => remota.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
});
