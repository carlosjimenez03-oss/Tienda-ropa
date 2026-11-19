import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { rutasAuth } from './auth/rutas.js';
import { rutasSync } from './sync.js';
import { rutasImagenes } from './imagenes.js';

/** Rutas que reciben navegación de terceros (sin cabecera personalizada). */
const SIN_CABECERA_CSRF = new Set(['/api/auth/apple/callback']);

export async function construirApp(
  cfg: Config,
  pool: Pool,
  logger = true,
): Promise<FastifyInstance> {
  // Se confía en un solo salto de proxy (Traefik en Dokploy) para leer la IP real del cliente
  const saltosProxy: number = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  const app = Fastify({
    logger,
    trustProxy: (_direccion: string, salto: number) => salto < saltosProxy,
    bodyLimit: 1_000_000,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: cfg.urlPublica.startsWith('https://') ? { maxAge: 31536000 } : false,
  });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, { global: false });

  // Protección CSRF: las peticiones que modifican datos deben llevar una cabecera
  // personalizada, que un formulario o enlace de otro sitio no puede añadir.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (SIN_CABECERA_CSRF.has(req.url.split('?')[0])) return;
    if (req.headers['x-inventario'] !== '1') {
      return reply.code(403).send({ error: 'cabecera_requerida' });
    }
  });

  app.get('/api/salud', { logLevel: 'warn' }, async () => {
    await pool.query('select 1');
    return { ok: true };
  });

  await app.register(rutasAuth, { pool, cfg });
  await app.register(rutasSync, { pool });
  await app.register(rutasImagenes, { pool, directorio: cfg.directorioSubidas });

  const estatico = path.resolve(cfg.directorioEstatico);
  if (existsSync(estatico)) {
    await app.register(fastifyStatic, {
      root: estatico,
      wildcard: false,
      setHeaders(res, ruta) {
        const nombre = path.basename(ruta);
        if (ruta.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        } else if (
          nombre === 'sw.js' ||
          nombre === 'index.html' ||
          nombre.endsWith('.webmanifest')
        ) {
          res.setHeader('cache-control', 'no-cache');
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply.code(404).send({ error: 'no_encontrado' });
      }
      reply.header('cache-control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }

  return app;
}
