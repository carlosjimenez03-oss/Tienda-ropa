import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { construirApp } from '../../server/app';
import { crearPool, migrar, type Pool } from '../../server/db';
import { asegurarAdminInicial } from '../../server/auth/rutas';
import type { Config } from '../../server/config';
import { generarCodigoLote } from '../../shared/lote';

const URL_DB = process.env.TEST_DATABASE_URL;
const d = URL_DB ? describe : describe.skip;

d('API (integración con Postgres)', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let cookie = '';
  const admin = { email: 'admin@tienda.test', contrasena: 'contrasena-segura-1' };

  const H = () => ({ cookie, 'x-inventario': '1' });

  beforeAll(async () => {
    pool = crearPool(URL_DB!);
    await pool.query('drop schema public cascade; create schema public;');
    await migrar(pool, () => {});
    const cfg: Config = {
      puerto: 0,
      databaseUrl: URL_DB!,
      urlPublica: 'http://localhost',
      produccion: false,
      directorioSubidas: await mkdtemp(path.join(os.tmpdir(), 'subidas-')),
      directorioEstatico: '/no-existe',
      adminEmail: admin.email,
      adminContrasena: admin.contrasena,
      diasSesion: 90,
      limiteLogin: 1000,
    };
    await asegurarAdminInicial(pool, cfg, () => {});
    app = await construirApp(cfg, pool, false);
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('sin sesión no se puede leer ni escribir nada', async () => {
    const pull = await app.inject({ method: 'GET', url: '/api/sync/pull?desde=0' });
    expect(pull.statusCode).toBe(401);
    const push = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { 'x-inventario': '1' },
      payload: { cambios: [] },
    });
    expect(push.statusCode).toBe(401);
    const img = await app.inject({ method: 'GET', url: `/api/imagenes/${randomUUID()}` });
    expect(img.statusCode).toBe(401);
    const usuarios = await app.inject({ method: 'GET', url: '/api/usuarios' });
    expect(usuarios.statusCode).toBe(401);
  });

  it('rechaza mutaciones sin la cabecera anti-CSRF', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/entrar',
      payload: { email: admin.email, contrasena: admin.contrasena },
    });
    expect(r.statusCode).toBe(403);
  });

  it('rechaza credenciales incorrectas', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/entrar',
      headers: { 'x-inventario': '1' },
      payload: { email: admin.email, contrasena: 'incorrecta' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('inicia sesión con correo y contraseña', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/entrar',
      headers: { 'x-inventario': '1' },
      payload: { email: admin.email, contrasena: admin.contrasena },
    });
    expect(r.statusCode).toBe(200);
    const c = r.cookies.find((k) => k.name === 'sid')!;
    expect(c.httpOnly).toBe(true);
    cookie = `sid=${c.value}`;
    const yo = await app.inject({ method: 'GET', url: '/api/auth/yo', headers: H() });
    expect(yo.json().usuario).toMatchObject({
      email: admin.email,
      es_propietario: true,
      debe_cambiar_contrasena: true,
    });
  });

  it('obliga a cambiar la contraseña inicial antes de usar la app', async () => {
    const bloqueado = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?desde=0',
      headers: H(),
    });
    expect(bloqueado.statusCode).toBe(403);
    expect(bloqueado.json().error).toBe('debe_cambiar_contrasena');
    const igual = await app.inject({
      method: 'POST',
      url: '/api/auth/contrasena',
      headers: H(),
      payload: { actual: admin.contrasena, nueva: admin.contrasena },
    });
    expect(igual.statusCode).toBe(400);
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/contrasena',
      headers: H(),
      payload: { actual: admin.contrasena, nueva: 'mi-nueva-contrasena-1' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().usuario.debe_cambiar_contrasena).toBe(false);
    admin.contrasena = 'mi-nueva-contrasena-1';
    const ok = await app.inject({ method: 'GET', url: '/api/sync/pull?desde=0', headers: H() });
    expect(ok.statusCode).toBe(200);
  });

  it('sincroniza producto, lote y movimientos de forma idempotente', async () => {
    const ahora = new Date().toISOString();
    const producto = {
      id: randomUUID(),
      nombre: 'Blusa',
      precio: 1200,
      creado_en: ahora,
      actualizado_en: ahora,
      eliminado: false,
    };
    const lote = {
      id: randomUUID(),
      codigo: generarCodigoLote(),
      producto_id: producto.id,
      creado_en: ahora,
    };
    const entrada = {
      id: randomUUID(),
      lote_id: lote.id,
      tipo: 'entrada',
      cantidad: 10,
      ocurrido_en: ahora,
      eliminado: false,
    };
    const cambios = [
      { id: 1, tabla: 'productos', operacion: 'upsert', payload: producto },
      { id: 2, tabla: 'lotes', operacion: 'insertar', payload: lote },
      { id: 3, tabla: 'movimientos', operacion: 'insertar', payload: entrada },
    ];
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: H(),
        payload: { cambios },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().resultados.every((x: { estado: string }) => x.estado === 'ok')).toBe(true);
    }
    const { rows } = await pool.query('select stock from stock_lotes where lote_id = $1', [
      lote.id,
    ]);
    expect(rows[0].stock).toBe(10);

    // Dos "dispositivos" venden del mismo lote estando offline
    const ventaA = {
      id: randomUUID(),
      lote_id: lote.id,
      tipo: 'salida',
      cantidad: 3,
      ocurrido_en: ahora,
      eliminado: false,
    };
    const ventaB = {
      id: randomUUID(),
      lote_id: lote.id,
      tipo: 'salida',
      cantidad: 4,
      ocurrido_en: ahora,
      eliminado: false,
    };
    await Promise.all(
      [ventaA, ventaB].map((v) =>
        app.inject({
          method: 'POST',
          url: '/api/sync/push',
          headers: H(),
          payload: {
            cambios: [{ id: 1, tabla: 'movimientos', operacion: 'insertar', payload: v }],
          },
        }),
      ),
    );
    const s = await pool.query('select stock from stock_lotes where lote_id = $1', [lote.id]);
    expect(s.rows[0].stock).toBe(3);

    // Anulación lógica
    const an = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: H(),
      payload: {
        cambios: [{ id: 9, tabla: 'movimientos', operacion: 'anular', payload: { id: ventaA.id } }],
      },
    });
    expect(an.json().resultados[0].estado).toBe('ok');
    const s2 = await pool.query('select stock from stock_lotes where lote_id = $1', [lote.id]);
    expect(s2.rows[0].stock).toBe(6);
  });

  it('último gana en productos según actualizado_en', async () => {
    const id = randomUUID();
    const t1 = '2026-01-01T10:00:00.000Z';
    const t2 = '2026-01-01T11:00:00.000Z';
    const base = { id, creado_en: t1, eliminado: false };
    const enviar = (nombre: string, actualizado_en: string) =>
      app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: H(),
        payload: {
          cambios: [
            {
              id: 1,
              tabla: 'productos',
              operacion: 'upsert',
              payload: { ...base, nombre, actualizado_en },
            },
          ],
        },
      });
    await enviar('Nuevo', t2);
    await enviar('Viejo', t1);
    const { rows } = await pool.query('select nombre from productos where id = $1', [id]);
    expect(rows[0].nombre).toBe('Nuevo');
  });

  it('regenera el código de lote si colisiona', async () => {
    const ahora = new Date().toISOString();
    const pid = randomUUID();
    const codigo = generarCodigoLote();
    const cambios = [
      {
        id: 1,
        tabla: 'productos',
        operacion: 'upsert',
        payload: {
          id: pid,
          nombre: 'Falda',
          creado_en: ahora,
          actualizado_en: ahora,
          eliminado: false,
        },
      },
      {
        id: 2,
        tabla: 'lotes',
        operacion: 'insertar',
        payload: { id: randomUUID(), codigo, producto_id: pid, creado_en: ahora },
      },
      {
        id: 3,
        tabla: 'lotes',
        operacion: 'insertar',
        payload: { id: randomUUID(), codigo, producto_id: pid, creado_en: ahora },
      },
    ];
    const r = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: H(),
      payload: { cambios },
    });
    expect(r.json().resultados.map((x: { estado: string }) => x.estado)).toEqual([
      'ok',
      'ok',
      'ok',
    ]);
    const { rows } = await pool.query(
      'select count(distinct codigo)::int n from lotes where producto_id = $1',
      [pid],
    );
    expect(rows[0].n).toBe(2);
  });

  it('marca como permanente un dato inválido sin bloquear el resto', async () => {
    const ahora = new Date().toISOString();
    const r = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: H(),
      payload: {
        cambios: [
          {
            id: 1,
            tabla: 'productos',
            operacion: 'upsert',
            payload: { id: randomUUID(), nombre: '', creado_en: ahora, actualizado_en: ahora },
          },
          {
            id: 2,
            tabla: 'productos',
            operacion: 'upsert',
            payload: { id: randomUUID(), nombre: 'Bien', creado_en: ahora, actualizado_en: ahora },
          },
          {
            id: 3,
            tabla: 'movimientos',
            operacion: 'insertar',
            payload: {
              id: randomUUID(),
              lote_id: randomUUID(),
              tipo: 'salida',
              cantidad: 1,
              ocurrido_en: ahora,
            },
          },
        ],
      },
    });
    expect(r.json().resultados.map((x: { estado: string }) => x.estado)).toEqual([
      'permanente',
      'ok',
      'reintentar',
    ]);
  });

  it('pull incremental paginado devuelve todo sin duplicar', async () => {
    let desde = 0;
    const vistos = new Set<string>();
    let paginas = 0;
    for (;;) {
      const r = await app.inject({
        method: 'GET',
        url: `/api/sync/pull?desde=${desde}&limite=2`,
        headers: H(),
      });
      const j = r.json();
      for (const t of ['productos', 'lotes', 'movimientos'])
        for (const f of j[t]) vistos.add(`${t}:${f.id}:${desde}`);
      desde = j.cursor;
      paginas++;
      if (!j.hayMas) break;
    }
    expect(paginas).toBeGreaterThan(1);
    const total = await pool.query(
      'select (select count(*) from productos) + (select count(*) from lotes) + (select count(*) from movimientos) as n',
    );
    expect(vistos.size).toBeGreaterThanOrEqual(total.rows[0].n);
    const vacio = await app.inject({
      method: 'GET',
      url: `/api/sync/pull?desde=${desde}`,
      headers: H(),
    });
    expect(vacio.json().productos).toHaveLength(0);
  });

  it('sube y sirve una imagen webp', async () => {
    const ahora = new Date().toISOString();
    const pid = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: H(),
      payload: {
        cambios: [
          {
            id: 1,
            tabla: 'productos',
            operacion: 'upsert',
            payload: {
              id: pid,
              nombre: 'Bolso',
              creado_en: ahora,
              actualizado_en: ahora,
              eliminado: false,
            },
          },
        ],
      },
    });
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBPVP8 '),
      Buffer.alloc(20),
    ]);
    const iid = randomUUID();
    const up = await app.inject({
      method: 'PUT',
      url: `/api/imagenes/${iid}?producto_id=${pid}`,
      headers: { ...H(), 'content-type': 'image/webp' },
      payload: webp,
    });
    expect(up.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/api/imagenes/${iid}`, headers: H() });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/webp');
    const malo = await app.inject({
      method: 'PUT',
      url: `/api/imagenes/${randomUUID()}?producto_id=${pid}`,
      headers: { ...H(), 'content-type': 'image/webp' },
      payload: Buffer.from('<svg>no</svg>'),
    });
    expect(malo.statusCode).toBe(415);
  });

  async function entrarComo(email: string, contrasena: string, nueva?: string) {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/entrar',
      headers: { 'x-inventario': '1' },
      payload: { email, contrasena },
    });
    expect(login.statusCode).toBe(200);
    const h = {
      cookie: `sid=${login.cookies.find((k) => k.name === 'sid')!.value}`,
      'x-inventario': '1',
    };
    if (nueva) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/contrasena',
        headers: h,
        payload: { actual: contrasena, nueva },
      });
      expect(r.statusCode).toBe(200);
    }
    return h;
  }

  it('crea usuarios con contraseña temporal y permisos, sin permitir escalar permisos', async () => {
    // La propietaria crea a una encargada que puede crear usuarios, pero no ver el resumen
    const r = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: H(),
      payload: {
        email: 'Encargada@Tienda.test',
        nombre: 'Ana',
        permisos: {
          puede_crear_usuarios: true,
          puede_ver_resumen: false,
          puede_editar_productos: true,
        },
      },
    });
    expect(r.statusCode).toBe(200);
    const temporal = r.json().contrasena_temporal as string;
    expect(temporal).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    const hEnc = await entrarComo('encargada@tienda.test', temporal, 'encargada-segura-1');

    // La encargada no puede dar "ver resumen" porque ella no lo tiene
    const escalar = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: hEnc,
      payload: { email: 'cajera@tienda.test', permisos: { puede_ver_resumen: true } },
    });
    expect(escalar.statusCode).toBe(403);
    expect(escalar.json().permiso).toBe('puede_ver_resumen');

    // Sí puede crear una cajera que solo vende
    const cajera = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: hEnc,
      payload: {
        email: 'cajera@tienda.test',
        permisos: {
          puede_vender: true,
          puede_agregar_mercancia: false,
          puede_crear_usuarios: false,
        },
      },
    });
    expect(cajera.statusCode).toBe(200);
    const hCaj = await entrarComo(
      'cajera@tienda.test',
      cajera.json().contrasena_temporal,
      'cajera-segura-12',
    );

    // La cajera no puede gestionar usuarios ni crear productos
    const lista = await app.inject({ method: 'GET', url: '/api/usuarios', headers: hCaj });
    expect(lista.statusCode).toBe(403);
    const ahora = new Date().toISOString();
    const prod = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: hCaj,
      payload: {
        cambios: [
          {
            id: 1,
            tabla: 'productos',
            operacion: 'upsert',
            payload: { id: randomUUID(), nombre: 'X', creado_en: ahora, actualizado_en: ahora },
          },
        ],
      },
    });
    expect(prod.json().resultados[0]).toMatchObject({ estado: 'permanente' });
    expect(prod.json().resultados[0].mensaje).toMatch(/permiso/);

    // La encargada no puede tocar a la propietaria ni a sí misma
    const listaEnc = await app.inject({ method: 'GET', url: '/api/usuarios', headers: hEnc });
    const propietaria = listaEnc
      .json()
      .usuarios.find((u: { es_propietario: boolean }) => u.es_propietario);
    expect(propietaria.gestionable).toBe(false);
    const tocar = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${propietaria.id}`,
      headers: hEnc,
      payload: { activo: false },
    });
    expect(tocar.statusCode).toBe(403);

    // La propietaria le quita a la encargada el permiso de crear usuarios
    const enc = listaEnc
      .json()
      .usuarios.find((u: { email: string }) => u.email === 'encargada@tienda.test');
    const quitar = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${enc.id}`,
      headers: H(),
      payload: { permisos: { puede_crear_usuarios: false } },
    });
    expect(quitar.statusCode).toBe(200);
    const yaNo = await app.inject({ method: 'GET', url: '/api/usuarios', headers: hEnc });
    expect(yaNo.statusCode).toBe(403);

    // Restablecer contraseña devuelve una temporal y obliga a cambiarla
    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${enc.id}`,
      headers: H(),
      payload: { restablecer_contrasena: true },
    });
    const h2 = await entrarComo('encargada@tienda.test', reset.json().contrasena_temporal);
    const bloqueada = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?desde=0',
      headers: h2,
    });
    expect(bloqueada.statusCode).toBe(403);
  });

  it('los movimientos son append-only en la base', async () => {
    const { rows } = await pool.query('select id from movimientos limit 1');
    await expect(
      pool.query('update movimientos set cantidad = 999 where id = $1', [rows[0].id]),
    ).rejects.toThrow(/append-only/);
    await pool.query('delete from movimientos where id = $1', [rows[0].id]);
    const sigue = await pool.query('select 1 from movimientos where id = $1', [rows[0].id]);
    expect(sigue.rowCount).toBe(1);
  });

  it('el acceso vence en la fecha indicada y se puede editar', async () => {
    const enUnaHora = new Date(Date.now() + 3_600_000).toISOString();
    const creado = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: H(),
      payload: { email: 'temporal@tienda.test', nombre: 'Temporal', vence_en: enUnaHora },
    });
    expect(creado.statusCode).toBe(200);
    const pasado = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: H(),
      payload: { email: 'otro@tienda.test', vence_en: '2020-01-01T00:00:00.000Z' },
    });
    expect(pasado.json().error).toBe('vencimiento_pasado');

    const h = await entrarComo(
      'temporal@tienda.test',
      creado.json().contrasena_temporal,
      'temporal-segura-1',
    );
    const id = creado.json().id;

    // Editar nombre, correo y ampliar el plazo
    const editar = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${id}`,
      headers: H(),
      payload: {
        nombre: 'Temporal editado',
        email: 'Temporal2@Tienda.test',
        vence_en: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(editar.statusCode).toBe(200);
    const lista = await app.inject({ method: 'GET', url: '/api/usuarios', headers: H() });
    const fila = lista.json().usuarios.find((u: { id: string }) => u.id === id);
    expect(fila).toMatchObject({ nombre: 'Temporal editado', email: 'temporal2@tienda.test' });
    expect(fila.vence_en).toBeTruthy();
    const duplicado = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${id}`,
      headers: H(),
      payload: { email: admin.email },
    });
    expect(duplicado.statusCode).toBe(409);

    // Al vencer, la sesión abierta deja de valer y no puede volver a entrar
    await pool.query("update usuarios set vence_en = now() - interval '1 minute' where id = $1", [
      id,
    ]);
    const conSesion = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?desde=0',
      headers: h,
    });
    expect(conSesion.statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/entrar',
      headers: { 'x-inventario': '1' },
      payload: { email: 'temporal2@tienda.test', contrasena: 'temporal-segura-1' },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toBe('cuenta_vencida');

    // Quitar el límite le devuelve el acceso
    await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${id}`,
      headers: H(),
      payload: { vence_en: null },
    });
    const otraVez = await app.inject({
      method: 'POST',
      url: '/api/auth/entrar',
      headers: { 'x-inventario': '1' },
      payload: { email: 'temporal2@tienda.test', contrasena: 'temporal-segura-1' },
    });
    expect(otraVez.statusCode).toBe(200);
  });

  it('quien crea un usuario puede ponerle la contraseña a mano, al crearlo o después', async () => {
    const debil = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: H(),
      payload: { email: 'manual@tienda.test', contrasena: 'corta' },
    });
    expect(debil.json().error).toBe('contrasena_debil');

    // Al crear: contraseña escrita a mano y sin obligar a cambiarla
    const r = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: H(),
      payload: {
        email: 'manual@tienda.test',
        contrasena: 'escrita-a-mano-1',
        exigir_cambio: false,
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().contrasena_temporal).toBeUndefined();
    const h = await entrarComo('manual@tienda.test', 'escrita-a-mano-1');
    const ok = await app.inject({ method: 'GET', url: '/api/sync/pull?desde=0', headers: h });
    expect(ok.statusCode).toBe(200);

    // Después: se cambia a mano; la sesión abierta se cierra y la anterior deja de valer
    const cambio = await app.inject({
      method: 'PATCH',
      url: `/api/usuarios/${r.json().id}`,
      headers: H(),
      payload: { contrasena: 'otra-escrita-2', exigir_cambio: true },
    });
    expect(cambio.statusCode).toBe(200);
    const cerrada = await app.inject({ method: 'GET', url: '/api/sync/pull?desde=0', headers: h });
    expect(cerrada.statusCode).toBe(401);
    const vieja = await app.inject({
      method: 'POST',
      url: '/api/auth/entrar',
      headers: { 'x-inventario': '1' },
      payload: { email: 'manual@tienda.test', contrasena: 'escrita-a-mano-1' },
    });
    expect(vieja.statusCode).toBe(401);
    const h2 = await entrarComo('manual@tienda.test', 'otra-escrita-2');
    const yo = await app.inject({ method: 'GET', url: '/api/auth/yo', headers: h2 });
    expect(yo.json().usuario.debe_cambiar_contrasena).toBe(true);
  });

  it('la cookie de sesión es Secure cuando la visita llega por HTTPS (detrás de Traefik)', async () => {
    const entrar = (proto: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/entrar',
        headers: { 'x-inventario': '1', 'x-forwarded-proto': proto },
        payload: { email: admin.email, contrasena: admin.contrasena },
      });
    const https = await entrar('https');
    expect(https.cookies.find((k) => k.name === 'sid')!.secure).toBe(true);
    const http = await entrar('http');
    expect(http.cookies.find((k) => k.name === 'sid')!.secure).toBeFalsy();
  });

  it('bloquea la cuenta tras varios intentos fallidos', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      headers: H(),
      payload: { email: 'bloqueo@tienda.test' },
    });
    let ultimo = 0;
    for (let i = 0; i < 6; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/entrar',
        headers: { 'x-inventario': '1', 'x-forwarded-for': `10.0.0.${i}` },
        payload: { email: 'bloqueo@tienda.test', contrasena: 'mala' },
      });
      ultimo = r.statusCode;
    }
    expect(ultimo).toBe(429);
  });
});
