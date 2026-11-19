import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Cliente, Pool } from './db.js';
import { permisosDe, requerirSesion } from './auth/rutas.js';
import type { Permisos } from '../shared/permisos.js';
import { generarCodigoLote } from '../shared/lote.js';
import {
  anulacionEsquema,
  loteEsquema,
  movimientoEsquema,
  productoEsquema,
  pushEsquema,
  type ResultadoCambio,
} from '../shared/esquemas.js';

/** Todas las escrituras se serializan con este candado para que las versiones
 *  se confirmen en orden y el pull incremental nunca se salte filas. */
const CANDADO_ESCRITURA = 727002;

class ErrorPermanente extends Error {}
class ErrorReintentable extends Error {}

function exigir(ok: boolean, accion: string) {
  if (!ok) throw new ErrorPermanente(`Tu usuario no tiene permiso para ${accion}`);
}

async function aplicarCambio(
  c: Cliente,
  usuarioId: string,
  permisos: Permisos,
  tabla: string,
  operacion: string,
  payload: unknown,
): Promise<void> {
  const puedeEntrada = permisos.puede_agregar_mercancia || permisos.puede_editar_productos;
  if (tabla === 'productos') {
    const p = productoEsquema.safeParse(payload);
    if (!p.success) throw new ErrorPermanente(`producto inválido: ${p.error.issues[0]?.message}`);
    const d = p.data;
    exigir(permisos.puede_editar_productos, 'crear o editar productos');
    // Último gana por actualizado_en
    await c.query(
      `insert into productos (id, nombre, sku, talla, color, precio, creado_por, creado_en, actualizado_en, eliminado, stock_minimo)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set
         nombre = excluded.nombre, sku = excluded.sku, talla = excluded.talla, color = excluded.color,
         precio = excluded.precio, stock_minimo = excluded.stock_minimo, actualizado_en = excluded.actualizado_en, eliminado = excluded.eliminado
       where productos.actualizado_en < excluded.actualizado_en`,
      [
        d.id,
        d.nombre,
        d.sku ?? null,
        d.talla ?? null,
        d.color ?? null,
        d.precio ?? null,
        usuarioId,
        d.creado_en,
        d.actualizado_en,
        d.eliminado,
        d.stock_minimo,
      ],
    );
    return;
  }
  if (tabla === 'lotes') {
    const p = loteEsquema.safeParse(payload);
    if (!p.success) throw new ErrorPermanente(`lote inválido: ${p.error.issues[0]?.message}`);
    const d = p.data;
    exigir(puedeEntrada, 'agregar mercancía');
    let codigo = d.codigo;
    for (let intento = 0; intento < 5; intento++) {
      await c.query('savepoint lote');
      try {
        await c.query(
          `insert into lotes (id, codigo, producto_id, creado_por, creado_en)
           values ($1,$2,$3,$4,$5) on conflict (id) do nothing`,
          [d.id, codigo, d.producto_id, usuarioId, d.creado_en],
        );
        await c.query('release savepoint lote');
        return;
      } catch (e) {
        await c.query('rollback to savepoint lote');
        const err = e as { code?: string; constraint?: string };
        if (err.code === '23505' && err.constraint === 'lotes_codigo_key') {
          // Colisión de código: se regenera; el cliente recibe el nuevo en el pull
          codigo = generarCodigoLote(new Date(d.creado_en));
          continue;
        }
        throw e;
      }
    }
    throw new ErrorReintentable('no se pudo generar un código de lote único');
  }
  if (tabla === 'movimientos' && operacion === 'insertar') {
    const p = movimientoEsquema.safeParse(payload);
    if (!p.success) throw new ErrorPermanente(`movimiento inválido: ${p.error.issues[0]?.message}`);
    const d = p.data;
    exigir(
      d.tipo === 'salida' ? permisos.puede_vender : puedeEntrada,
      d.tipo === 'salida' ? 'vender' : 'agregar mercancía',
    );
    await c.query(
      `insert into movimientos (id, lote_id, tipo, cantidad, nota, usuario_id, ocurrido_en, eliminado, precio_unitario)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
      [
        d.id,
        d.lote_id,
        d.tipo,
        d.cantidad,
        d.nota ?? null,
        usuarioId,
        d.ocurrido_en,
        d.eliminado,
        d.precio_unitario ?? null,
      ],
    );
    return;
  }
  if (tabla === 'movimientos' && operacion === 'anular') {
    const p = anulacionEsquema.safeParse(payload);
    if (!p.success) throw new ErrorPermanente('anulación inválida');
    const previo = await c.query<{ tipo: string }>('select tipo from movimientos where id = $1', [
      p.data.id,
    ]);
    if (previo.rows[0]) {
      exigir(
        previo.rows[0].tipo === 'salida' ? permisos.puede_vender : puedeEntrada,
        'deshacer este movimiento',
      );
    }
    const r = await c.query(
      'update movimientos set eliminado = true where id = $1 and not eliminado',
      [p.data.id],
    );
    if (r.rowCount === 0) {
      const existe = await c.query('select 1 from movimientos where id = $1', [p.data.id]);
      if (existe.rowCount === 0) throw new ErrorReintentable('el movimiento aún no existe');
    }
    return;
  }
  throw new ErrorPermanente(`operación desconocida ${tabla}.${operacion}`);
}

export async function procesarPush(
  pool: Pool,
  usuarioId: string,
  permisos: Permisos,
  cambios: z.infer<typeof pushEsquema>['cambios'],
): Promise<ResultadoCambio[]> {
  const resultados: ResultadoCambio[] = [];
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('select pg_advisory_xact_lock($1)', [CANDADO_ESCRITURA]);
    for (const cambio of cambios) {
      await c.query('savepoint cambio');
      try {
        await aplicarCambio(c, usuarioId, permisos, cambio.tabla, cambio.operacion, cambio.payload);
        await c.query('release savepoint cambio');
        resultados.push({ id: cambio.id, estado: 'ok' });
      } catch (e) {
        await c.query('rollback to savepoint cambio');
        const err = e as Error & { code?: string };
        if (e instanceof ErrorPermanente) {
          resultados.push({ id: cambio.id, estado: 'permanente', mensaje: err.message });
        } else if (e instanceof ErrorReintentable || err.code === '23503') {
          // 23503 = FK: el padre puede llegar en un envío posterior
          resultados.push({ id: cambio.id, estado: 'reintentar', mensaje: err.message });
        } else if (err.code && /^(22|23)/.test(err.code)) {
          resultados.push({ id: cambio.id, estado: 'permanente', mensaje: err.message });
        } else {
          throw e;
        }
      }
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return resultados;
}

const TABLAS_PULL = {
  productos:
    'select id, nombre, sku, talla, color, precio, stock_minimo, creado_por, creado_en, actualizado_en, eliminado, version from productos',
  lotes: 'select id, codigo, producto_id, creado_por, creado_en, version from lotes',
  movimientos:
    'select id, lote_id, tipo, cantidad, nota, precio_unitario, usuario_id, ocurrido_en, sincronizado_en, eliminado, version from movimientos',
  imagenes: 'select id, producto_id, ruta, creado_en, eliminado, version from imagenes',
} as const;

export async function procesarPull(pool: Pool, desde: number, limite: number) {
  const porTabla = await Promise.all(
    Object.entries(TABLAS_PULL).map(async ([tabla, sql]) => {
      const { rows } = await pool.query(`${sql} where version > $1 order by version limit $2`, [
        desde,
        limite + 1,
      ]);
      return rows.map((fila) => ({ tabla, fila }));
    }),
  );
  const todas = porTabla.flat().sort((a, b) => a.fila.version - b.fila.version);
  const pagina = todas.slice(0, limite);
  const hayMas = todas.length > limite;
  const salida: Record<string, unknown[]> = {
    productos: [],
    lotes: [],
    movimientos: [],
    imagenes: [],
  };
  for (const { tabla, fila } of pagina) {
    const { version: _v, ...resto } = fila;
    salida[tabla].push(resto);
  }
  const cursor = pagina.length > 0 ? pagina[pagina.length - 1].fila.version : desde;
  return { ...salida, cursor, hayMas };
}

export async function rutasSync(app: FastifyInstance, opts: { pool: Pool }) {
  const { pool } = opts;

  app.post(
    '/api/sync/push',
    { preHandler: requerirSesion(pool), bodyLimit: 2_000_000 },
    async (req, reply) => {
      const datos = pushEsquema.safeParse(req.body);
      if (!datos.success)
        return reply.code(400).send({ error: 'datos_invalidos', detalle: datos.error.issues });
      const resultados = await procesarPush(
        pool,
        req.sesion!.usuario.id,
        permisosDe(req.sesion!.usuario),
        datos.data.cambios,
      );
      return { resultados };
    },
  );

  app.get<{ Querystring: { desde?: string; limite?: string } }>(
    '/api/sync/pull',
    { preHandler: requerirSesion(pool) },
    async (req, reply) => {
      const desde = Number(req.query.desde ?? 0);
      const limite = Math.min(Math.max(Number(req.query.limite ?? 500), 1), 2000);
      if (!Number.isSafeInteger(desde) || desde < 0 || !Number.isFinite(limite)) {
        return reply.code(400).send({ error: 'datos_invalidos' });
      }
      return procesarPull(pool, desde, limite);
    },
  );
}

export { CANDADO_ESCRITURA };
