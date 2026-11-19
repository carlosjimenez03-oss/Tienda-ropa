import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { mkdir, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Pool } from './db.js';
import { requerirSesion } from './auth/rutas.js';
import { CANDADO_ESCRITURA } from './sync.js';

const MAX_BYTES = 3 * 1024 * 1024;

export function detectarFormato(b: Buffer): 'webp' | 'jpg' | 'png' | null {
  if (
    b.length > 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'png';
  return null;
}

const TIPOS = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' } as const;

export async function rutasImagenes(
  app: FastifyInstance,
  opts: { pool: Pool; directorio: string },
) {
  const { pool } = opts;
  const raiz = path.resolve(opts.directorio);
  await mkdir(raiz, { recursive: true });

  app.addContentTypeParser(
    /^image\//,
    { parseAs: 'buffer', bodyLimit: MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.put<{ Params: { id: string }; Querystring: { producto_id?: string } }>(
    '/api/imagenes/:id',
    { preHandler: requerirSesion(pool), bodyLimit: MAX_BYTES },
    async (req, reply) => {
      const ids = z.object({ id: z.string().uuid(), producto_id: z.string().uuid() }).safeParse({
        id: req.params.id,
        producto_id: req.query.producto_id,
      });
      if (!ids.success || !Buffer.isBuffer(req.body))
        return reply.code(400).send({ error: 'datos_invalidos' });
      const formato = detectarFormato(req.body);
      if (!formato) return reply.code(415).send({ error: 'formato_no_soportado' });

      const existente = await pool.query('select ruta from imagenes where id = $1', [ids.data.id]);
      if (existente.rowCount) return { ok: true, ruta: existente.rows[0].ruta };

      const producto = await pool.query('select 1 from productos where id = $1', [
        ids.data.producto_id,
      ]);
      if (!producto.rowCount) return reply.code(409).send({ error: 'producto_no_sincronizado' });

      const ruta = `productos/${ids.data.producto_id}/${ids.data.id}.${formato}`;
      const destino = path.join(raiz, ruta);
      await mkdir(path.dirname(destino), { recursive: true });
      const temporal = `${destino}.tmp`;
      await writeFile(temporal, req.body);
      await rename(temporal, destino);

      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query('select pg_advisory_xact_lock($1)', [CANDADO_ESCRITURA]);
        await c.query(
          `insert into imagenes (id, producto_id, ruta, creado_por) values ($1,$2,$3,$4)
           on conflict (id) do nothing`,
          [ids.data.id, ids.data.producto_id, ruta, req.sesion!.usuario.id],
        );
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      } finally {
        c.release();
      }
      return { ok: true, ruta };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/imagenes/:id',
    { preHandler: requerirSesion(pool) },
    async (req, reply) => {
      if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send();
      const { rows } = await pool.query('select ruta from imagenes where id = $1', [req.params.id]);
      if (!rows.length) return reply.code(404).send({ error: 'no_encontrada' });
      const destino = path.join(raiz, rows[0].ruta);
      if (!destino.startsWith(raiz + path.sep)) return reply.code(400).send();
      try {
        await stat(destino);
      } catch {
        return reply.code(404).send({ error: 'archivo_no_encontrado' });
      }
      const ext = path.extname(destino).slice(1) as keyof typeof TIPOS;
      reply.header('content-type', TIPOS[ext] ?? 'application/octet-stream');
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      return reply.send(createReadStream(destino));
    },
  );
}
