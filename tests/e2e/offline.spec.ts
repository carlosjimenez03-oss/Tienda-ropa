import { expect, test, type Browser, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@tienda.test';
const CONTRASENA = process.env.E2E_PASSWORD ?? 'contrasena-segura-1';

const CONTRASENA_NUEVA = `${CONTRASENA}-cambiada`;

/** Inicia sesión; si es la primera vez, completa el cambio obligatorio de contraseña. */
async function entrar(pagina: Page, email: string, contrasenas: string[], nueva: string) {
  for (const clave of contrasenas) {
    await pagina.getByLabel('Correo').fill(email);
    await pagina.getByLabel('Contraseña', { exact: true }).fill(clave);
    await pagina.getByRole('button', { name: 'Entrar' }).click();
    const resultado = await Promise.race([
      pagina
        .getByRole('heading', { name: 'Crea tu contraseña' })
        .waitFor()
        .then(() => 'cambiar'),
      pagina
        .getByRole('navigation')
        .waitFor()
        .then(() => 'dentro'),
      pagina
        .getByRole('alert')
        .waitFor()
        .then(() => 'error'),
    ]);
    if (resultado === 'dentro') return;
    if (resultado === 'cambiar') {
      await pagina.getByLabel('Contraseña temporal').fill(clave);
      await pagina.getByLabel('Nueva contraseña (mínimo 10 caracteres)').fill(nueva);
      await pagina.getByLabel('Repite la nueva contraseña').fill(nueva);
      await pagina.getByRole('button', { name: 'Guardar y entrar' }).click();
      await pagina.getByRole('navigation').waitFor();
      return;
    }
  }
  throw new Error(`No se pudo entrar como ${email}`);
}

/** La primera vez la app pregunta por los avisos; en las pruebas se responde "Ahora no". */
async function responderAvisos(pagina: Page) {
  const ahoraNo = pagina.getByRole('button', { name: 'Ahora no' });
  await ahoraNo.waitFor({ timeout: 3000 }).then(
    () => ahoraNo.click(),
    () => {},
  );
}

async function nuevoDispositivo(browser: Browser): Promise<Page> {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  await pagina.goto('/');
  await entrar(pagina, EMAIL, [CONTRASENA_NUEVA, CONTRASENA], CONTRASENA_NUEVA);
  await responderAvisos(pagina);
  await expect(pagina.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  // Espera a que el service worker controle la página (necesario para funcionar offline)
  await pagina
    .waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 10_000 })
    .catch(async () => {
      await pagina.reload();
      await pagina.waitForFunction(() => navigator.serviceWorker?.controller != null);
    });
  await expect(pagina.getByTestId('estado-sync')).toContainText('Todo al día');
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
  await page.getByLabel('Contraseña', { exact: true }).fill('mala-contrasena');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrectos');
});

test('alta de producto sin conexión y sincronización al reconectar', async ({ browser }) => {
  const nombre = `Vestido E2E ${Date.now()}`;
  const a = await nuevoDispositivo(browser);

  await a.context().setOffline(true);
  await a.reload(); // la app debe abrir sin red desde el service worker
  await expect(a.getByRole('heading', { name: 'Resumen' })).toBeVisible();

  await irA(a, 'Nuevo');
  await a.getByLabel('Nombre del producto').fill(nombre);
  await a.getByLabel('Precio de venta (RD$)').fill('1500');
  await a.getByLabel('¿Cuántas unidades tienes?').fill('10');
  await a.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(a.getByRole('heading', { name: nombre })).toBeVisible();
  await expect(a.getByTestId('codigo-lote').first()).toHaveText(/^\d{8}-[A-Z2-9]{4}$/);
  await expect(a.getByTestId('estado-sync')).toContainText('Sin internet · 3 cambios guardados');

  await a.context().setOffline(false);
  await expect(a.getByTestId('estado-sync')).toContainText('Todo al día', { timeout: 20_000 });

  // Otro dispositivo lo ve
  const b = await nuevoDispositivo(browser);
  await irA(b, 'Productos');
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
  await a.getByLabel('Nombre del producto').fill(nombre);
  await a.getByLabel('¿Cuántas unidades tienes?').fill('10');
  await a.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(a.getByRole('heading', { name: nombre })).toBeVisible();
  await expect(a.getByTestId('estado-sync')).toContainText('Todo al día', { timeout: 20_000 });

  const b = await nuevoDispositivo(browser);
  await irA(b, 'Productos');
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
    await expect(p.getByTestId('estado-sync')).toContainText('Todo al día', { timeout: 20_000 });
  }
  // Una segunda vuelta para que cada uno reciba las ventas del otro
  for (const p of [a, b]) {
    await p.getByTestId('estado-sync').click();
    await expect(p.getByTestId('estado-sync')).toContainText('Todo al día', { timeout: 20_000 });
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
  await a.getByLabel('Nombre del producto').fill(nombre);
  await a.locator('input[type=file]').last().setInputFiles('public/iconos/icono-512.png');
  await expect(a.getByAltText('Vista previa')).toBeVisible();
  await a.getByRole('button', { name: 'Guardar producto' }).click();
  const img = a.getByRole('img', { name: nombre });
  await expect(img).toHaveAttribute('src', /^blob:/);
  await a.context().setOffline(false);
  await expect(a.getByTestId('estado-sync')).toContainText('Todo al día', { timeout: 20_000 });
  await expect(img).toHaveAttribute('src', /^\/api\/imagenes\//);

  const b = await nuevoDispositivo(browser);
  await irA(b, 'Productos');
  await b.getByLabel('Buscar productos').fill(nombre);
  const remota = tarjeta(b, nombre).getByRole('img', { name: nombre });
  await expect(remota).toHaveAttribute('src', /^\/api\/imagenes\//);
  await expect
    .poll(() => remota.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
});

test('avisa cuando un producto se está acabando y el resumen muestra lo vendido', async ({
  browser,
}) => {
  const nombre = `Sombrero ${Date.now()}`;
  const a = await nuevoDispositivo(browser);
  await irA(a, 'Nuevo');
  await a.getByLabel('Nombre del producto').fill(nombre);
  await a.getByLabel('Precio de venta (RD$)').fill('1,000');
  await a.getByLabel('¿Cuántas unidades tienes?').fill('4');
  await a.getByLabel('Avisarme cuando queden').fill('2');
  await a.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(a.getByRole('status')).toContainText('Producto guardado');

  await irA(a, 'Vender');
  await a.getByLabel('Buscar producto').fill(nombre);
  await a.getByRole('button', { name: new RegExp(nombre) }).click();
  await a.getByRole('button', { name: 'Una más' }).click();
  await expect(a.getByText('Total:')).toContainText('RD$2,000.00');
  await a.getByRole('button', { name: 'Registrar venta' }).click();
  await expect(a.getByTestId('alerta-stock')).toContainText(`Quedan solo 2 de ${nombre}`);

  await irA(a, 'Inicio');
  await expect(a.getByTestId('alertas-stock')).toContainText(nombre);
  await expect(a.getByTestId('cifra-vendido')).not.toContainText('RD$0.00');
  await irA(a, 'Productos');
  await a.getByLabel('Buscar productos').fill(nombre);
  await expect(tarjeta(a, nombre).getByText('Quedan pocos')).toBeVisible();
});

test('quien tiene permiso crea un usuario con permisos limitados y este debe cambiar la contraseña', async ({
  browser,
}) => {
  const a = await nuevoDispositivo(browser);
  const email = `cajera${Date.now()}@tienda.test`;
  await irA(a, 'Ajustes');
  await a.getByRole('button', { name: '+ Crear usuario' }).click();
  await a.getByLabel('Correo', { exact: true }).fill(email);
  await a.getByLabel('Nombre', { exact: true }).fill('Cajera');
  // Solo vender: se quita "Agregar mercancía" (marcado por defecto)
  await a.getByRole('checkbox', { name: /Agregar mercancía/ }).uncheck();
  await a.getByRole('button', { name: 'Crear usuario' }).click();
  const temporal = (await a.getByTestId('contrasena-temporal').textContent())!.trim();
  expect(temporal).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

  const contexto = await browser.newContext();
  const b = await contexto.newPage();
  await b.goto('/');
  await entrar(b, email, [temporal], 'cajera-contrasena-1');
  await responderAvisos(b);
  await expect(b.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  const nav = b.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Vender' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Nuevo' })).toHaveCount(0);
  await irA(b, 'Vender');
  await expect(b.getByRole('radio', { name: /Llegó mercancía/ })).toHaveCount(0);
  await irA(b, 'Ajustes');
  await expect(b.getByRole('heading', { name: 'Usuarios' })).toHaveCount(0);
});

test('se le pone un tiempo de acceso al usuario y luego se edita', async ({ browser }) => {
  const a = await nuevoDispositivo(browser);
  const email = `temporal${Date.now()}@tienda.test`;
  await irA(a, 'Ajustes');
  await a.getByRole('button', { name: '+ Crear usuario' }).click();
  await a.getByLabel('Correo', { exact: true }).fill(email);
  await a.getByLabel('Nombre', { exact: true }).fill('Temporal');
  await a.getByLabel('Tiempo de acceso').selectOption('7');
  await a.getByRole('button', { name: 'Crear usuario' }).click();
  await expect(a.getByTestId('contrasena-temporal')).toBeVisible();

  const fila = a.getByRole('listitem').filter({ hasText: email });
  await expect(fila.getByText(/Acceso hasta/)).toBeVisible();

  await fila.getByRole('button', { name: 'Editar' }).click();
  await fila.getByLabel('Nombre', { exact: true }).fill('Temporal editado');
  await fila.getByLabel('Tiempo de acceso').selectOption('fecha');
  await fila.getByLabel('Fecha de vencimiento').fill('2099-12-31');
  await fila.getByRole('button', { name: 'Guardar cambios' }).click();

  const editada = a.getByRole('listitem').filter({ hasText: email });
  await expect(editada.getByText(/Acceso hasta 31 de diciembre de 2099/)).toBeVisible();

  await editada.getByRole('button', { name: 'Editar' }).click();
  await editada.getByLabel('Tiempo de acceso').selectOption('sin');
  await editada.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(
    a
      .getByRole('listitem')
      .filter({ hasText: 'Temporal editado' })
      .getByText(/Acceso hasta/),
  ).toHaveCount(0);
});

test('al abrir la app por primera vez pregunta por los avisos y no insiste después', async ({
  browser,
}) => {
  const contexto = await browser.newContext();
  const p = await contexto.newPage();
  await p.goto('/');
  await entrar(p, EMAIL, [CONTRASENA_NUEVA, CONTRASENA], CONTRASENA_NUEVA);
  const dialogo = p.getByRole('dialog', { name: '¿Activar los avisos?' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole('button', { name: 'Permitir' })).toBeVisible();
  await dialogo.getByRole('button', { name: 'Ahora no' }).click();
  await expect(dialogo).toHaveCount(0);
  await p.reload();
  await expect(p.getByRole('navigation')).toBeVisible();
  await expect(p.getByRole('dialog', { name: '¿Activar los avisos?' })).toHaveCount(0);

  await irA(p, 'Ajustes');
  const fila = p.getByTestId('permiso-Notificaciones');
  await expect(fila).toContainText('Preguntar cada vez');
  await expect(fila.getByRole('button', { name: 'Permitir notificaciones' })).toBeVisible();
});

test('tomar foto explica el permiso, abre la cámara dentro de la app y guarda la foto', async ({
  browser,
}) => {
  const a = await nuevoDispositivo(browser);
  await irA(a, 'Nuevo');
  await a.getByRole('button', { name: '📷 Tomar foto' }).click();
  const explicacion = a.getByRole('dialog', { name: 'Permitir el uso de la cámara' });
  // Si el navegador ya concedió el permiso se salta la explicación
  if (await explicacion.isVisible())
    await explicacion.getByRole('button', { name: 'Continuar' }).click();
  const camara = a.getByRole('dialog', { name: 'Cámara' });
  await expect(camara).toBeVisible();
  await camara.getByRole('button', { name: 'Tomar foto', exact: true }).click();
  await expect(a.getByAltText('Vista previa')).toBeVisible();
});

test('la contraseña de un usuario creado se puede escribir a mano y cambiar después', async ({
  browser,
}) => {
  const a = await nuevoDispositivo(browser);
  const email = `manual${Date.now()}@tienda.test`;
  await irA(a, 'Ajustes');
  await a.getByRole('button', { name: '+ Crear usuario' }).click();
  await a.getByLabel('Correo', { exact: true }).fill(email);
  await a.getByRole('radio', { name: 'Escribirla yo' }).check();
  await a.getByLabel('Contraseña (mínimo 10 caracteres)').fill('primera-clave-1');
  await a.getByRole('button', { name: 'Crear usuario' }).click();
  await expect(a.getByRole('status')).toContainText(`Usuario ${email} creado`);

  // Entra directamente con la contraseña escrita (sin cambio obligatorio)
  const b = await (await browser.newContext()).newPage();
  await b.goto('/');
  await b.getByLabel('Correo').fill(email);
  await b.getByLabel('Contraseña', { exact: true }).fill('primera-clave-1');
  await b.getByRole('button', { name: 'Entrar' }).click();
  await expect(b.getByRole('navigation')).toBeVisible();
  await expect(b.getByRole('heading', { name: 'Crea tu contraseña' })).toHaveCount(0);

  // Se le cambia a mano desde Editar
  const fila = a.getByRole('listitem').filter({ hasText: email });
  await fila.getByRole('button', { name: 'Editar' }).click();
  await fila.getByLabel('Contraseña (mínimo 10 caracteres)').fill('segunda-clave-2');
  await fila.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(a.getByRole('status')).toContainText('cambiada');

  const c = await (await browser.newContext()).newPage();
  await c.goto('/');
  await c.getByLabel('Correo').fill(email);
  await c.getByLabel('Contraseña', { exact: true }).fill('primera-clave-1');
  await c.getByRole('button', { name: 'Entrar' }).click();
  await expect(c.getByRole('alert')).toContainText('incorrectos');
  await c.getByLabel('Contraseña', { exact: true }).fill('segunda-clave-2');
  await c.getByRole('button', { name: 'Entrar' }).click();
  await expect(c.getByRole('navigation')).toBeVisible();
});
