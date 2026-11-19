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
      limiteLogin: 10,
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
    const usuarias = await app.inject({ method: 'GET', url: '/api/usuarias' });
    expect(usuarias.statusCode).toBe(401);
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
    expect(yo.json().usuario.email).toBe(admin.email);
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

  it('la administración crea usuarias y una usuaria normal no puede', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/usuarias',
      headers: H(),
      payload: { email: 'Vendedora@Tienda.test', nombre: 'Ana', contrasena: 'otra-contrasena-1' },
    });
    expect(r.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/entrar',
      headers: { 'x-inventario': '1' },
      payload: { email: 'vendedora@tienda.test', contrasena: 'otra-contrasena-1' },
    });
    const c = login.cookies.find((k) => k.name === 'sid')!;
    const lista = await app.inject({
      method: 'GET',
      url: '/api/usuarias',
      headers: { cookie: `sid=${c.value}` },
    });
    expect(lista.statusCode).toBe(403);
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

  it('bloquea la cuenta tras varios intentos fallidos', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/usuarias',
      headers: H(),
      payload: { email: 'bloqueo@tienda.test', contrasena: 'contrasena-bloqueo' },
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
