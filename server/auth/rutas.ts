import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Pool } from '../db.js';
import { contrasenaValida, hashContrasena, verificarContrasena } from './contrasena.js';
import {
  aleatorioUrl,
  canjearCodigoApple,
  canjearCodigoGoogle,
  urlAutorizacionApple,
  urlAutorizacionGoogle,
  type IdentidadExterna,
} from './oauth.js';
import {
  cerrarSesion,
  crearSesion,
  leerSesion,
  usuarioPublico,
  type FilaUsuario,
  type SesionActual,
} from './sesiones.js';
import { nuevoSecreto, totpPara, verificarCodigo } from './totp.js';

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

declare module 'fastify' {
  interface FastifyRequest {
    sesion?: SesionActual;
  }
}

export function requerirSesion(pool: Pool) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const sesion = await leerSesion(pool, req);
    if (!sesion || sesion.mfaPendiente) {
      return reply.code(401).send({ error: 'sesion_requerida' });
    }
    req.sesion = sesion;
  };
}

export function requerirAdmin(pool: Pool) {
  const base = requerirSesion(pool);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await base(req, reply);
    if (reply.sent) return;
    if (req.sesion!.usuario.rol !== 'admin') return reply.code(403).send({ error: 'solo_admin' });
  };
}

const loginEsquema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  contrasena: z.string().min(1).max(200),
});
const codigoEsquema = z.object({ codigo: z.string().trim().min(6).max(10) });
const nuevaUsuariaEsquema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  nombre: z.string().trim().max(120).default(''),
  contrasena: z.string().optional(),
  rol: z.enum(['admin', 'usuaria']).default('usuaria'),
});
const cambioContrasenaEsquema = z.object({
  actual: z.string().max(200).optional(),
  nueva: z.string(),
});

export async function asegurarAdminInicial(pool: Pool, cfg: Config, log: (m: string) => void) {
  if (!cfg.adminEmail || !cfg.adminContrasena) return;
  const { rows } = await pool.query('select count(*)::int as n from usuarios');
  if (rows[0].n > 0) return;
  const error = contrasenaValida(cfg.adminContrasena);
  if (error) throw new Error(`ADMIN_PASSWORD inválida: ${error}`);
  await pool.query(
    `insert into usuarios (email, nombre, hash_contrasena, rol) values ($1, 'Administración', $2, 'admin')`,
    [cfg.adminEmail, await hashContrasena(cfg.adminContrasena)],
  );
  log(`usuaria administradora creada: ${cfg.adminEmail}`);
}

export async function rutasAuth(app: FastifyInstance, opts: { pool: Pool; cfg: Config }) {
  const { pool, cfg } = opts;
  const seguro = cfg.urlPublica.startsWith('https://');
  const opcionesSesion = (mfaPendiente: boolean) => ({
    mfaPendiente,
    dias: cfg.diasSesion,
    seguro,
  });
  const limiteLogin = { config: { rateLimit: { max: cfg.limiteLogin, timeWindow: '1 minute' } } };

  app.get('/api/auth/proveedores', async () => ({
    google: Boolean(cfg.google),
    apple: Boolean(cfg.apple),
  }));

  app.get('/api/auth/yo', async (req, reply) => {
    const sesion = await leerSesion(pool, req);
    if (!sesion) return reply.code(401).send({ error: 'sesion_requerida' });
    if (sesion.mfaPendiente) return reply.code(401).send({ error: 'mfa_requerido' });
    return { usuario: usuarioPublico(sesion.usuario) };
  });

  app.post('/api/auth/entrar', limiteLogin, async (req, reply) => {
    const datos = loginEsquema.safeParse(req.body);
    if (!datos.success) return reply.code(400).send({ error: 'datos_invalidos' });
    const { rows } = await pool.query<FilaUsuario>('select * from usuarios where email = $1', [
      datos.data.email,
    ]);
    const u = rows[0];
    if (u?.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
      return reply.code(429).send({ error: 'cuenta_bloqueada_temporalmente' });
    }
    const ok = await verificarContrasena(datos.data.contrasena, u?.hash_contrasena ?? null);
    if (!u || !ok || !u.activo) {
      if (u) {
        await pool.query(
          `update usuarios set intentos_fallidos = intentos_fallidos + 1,
             bloqueado_hasta = case when intentos_fallidos + 1 >= $2
               then now() + make_interval(mins => $3) else bloqueado_hasta end
           where id = $1`,
          [u.id, MAX_INTENTOS, MINUTOS_BLOQUEO],
        );
      }
      return reply.code(401).send({ error: 'credenciales_invalidas' });
    }
    await pool.query(
      'update usuarios set intentos_fallidos = 0, bloqueado_hasta = null where id = $1',
      [u.id],
    );
    await crearSesion(pool, reply, u.id, opcionesSesion(u.totp_activo));
    if (u.totp_activo) return { mfa: true };
    return { usuario: usuarioPublico(u) };
  });

  app.post('/api/auth/mfa/verificar', limiteLogin, async (req, reply) => {
    const sesion = await leerSesion(pool, req);
    if (!sesion || !sesion.mfaPendiente) return reply.code(401).send({ error: 'sesion_requerida' });
    const datos = codigoEsquema.safeParse(req.body);
    const u = sesion.usuario;
    if (
      !datos.success ||
      !u.totp_secreto ||
      !verificarCodigo(u.totp_secreto, u.email, datos.data.codigo)
    ) {
      return reply.code(401).send({ error: 'codigo_invalido' });
    }
    await pool.query('delete from sesiones where id = $1', [sesion.tokenHash]);
    await crearSesion(pool, reply, u.id, opcionesSesion(false));
    return { usuario: usuarioPublico(u) };
  });

  app.post('/api/auth/salir', async (req, reply) => {
    await cerrarSesion(pool, req, reply);
    return { ok: true };
  });

  // ---------- MFA (TOTP) ----------
  app.post('/api/auth/mfa/configurar', { preHandler: requerirSesion(pool) }, async (req) => {
    const u = req.sesion!.usuario;
    if (u.totp_activo) return { ya_activo: true };
    const secreto = nuevoSecreto();
    await pool.query('update usuarios set totp_secreto = $2 where id = $1', [u.id, secreto]);
    const uri = totpPara(secreto, u.email).toString();
    return { secreto, uri, qr: await QRCode.toDataURL(uri) };
  });

  app.post('/api/auth/mfa/activar', { preHandler: requerirSesion(pool) }, async (req, reply) => {
    const u = req.sesion!.usuario;
    const datos = codigoEsquema.safeParse(req.body);
    if (
      !datos.success ||
      !u.totp_secreto ||
      !verificarCodigo(u.totp_secreto, u.email, datos.data.codigo)
    ) {
      return reply.code(400).send({ error: 'codigo_invalido' });
    }
    await pool.query('update usuarios set totp_activo = true where id = $1', [u.id]);
    return { ok: true };
  });

  app.post('/api/auth/mfa/desactivar', { preHandler: requerirSesion(pool) }, async (req, reply) => {
    const u = req.sesion!.usuario;
    const datos = codigoEsquema.safeParse(req.body);
    if (
      !datos.success ||
      !u.totp_secreto ||
      !verificarCodigo(u.totp_secreto, u.email, datos.data.codigo)
    ) {
      return reply.code(400).send({ error: 'codigo_invalido' });
    }
    await pool.query('update usuarios set totp_activo = false, totp_secreto = null where id = $1', [
      u.id,
    ]);
    return { ok: true };
  });

  app.post('/api/auth/contrasena', { preHandler: requerirSesion(pool) }, async (req, reply) => {
    const u = req.sesion!.usuario;
    const datos = cambioContrasenaEsquema.safeParse(req.body);
    if (!datos.success) return reply.code(400).send({ error: 'datos_invalidos' });
    const error = contrasenaValida(datos.data.nueva);
    if (error) return reply.code(400).send({ error: 'contrasena_debil', mensaje: error });
    if (
      u.hash_contrasena &&
      !(await verificarContrasena(datos.data.actual ?? '', u.hash_contrasena))
    ) {
      return reply.code(401).send({ error: 'contrasena_actual_incorrecta' });
    }
    await pool.query('update usuarios set hash_contrasena = $2 where id = $1', [
      u.id,
      await hashContrasena(datos.data.nueva),
    ]);
    // Cierra las demás sesiones
    await pool.query('delete from sesiones where usuario_id = $1 and id <> $2', [
      u.id,
      req.sesion!.tokenHash,
    ]);
    return { ok: true };
  });

  // ---------- Administración de usuarias ----------
  app.get('/api/usuarias', { preHandler: requerirAdmin(pool) }, async () => {
    const { rows } = await pool.query(
      `select id, email, nombre, rol, activo, totp_activo as mfa_activo,
              google_sub is not null as google, apple_sub is not null as apple,
              hash_contrasena is not null as con_contrasena, creado_en
         from usuarios order by creado_en`,
    );
    return { usuarias: rows };
  });

  app.post('/api/usuarias', { preHandler: requerirAdmin(pool) }, async (req, reply) => {
    const datos = nuevaUsuariaEsquema.safeParse(req.body);
    if (!datos.success) return reply.code(400).send({ error: 'datos_invalidos' });
    let hash: string | null = null;
    if (datos.data.contrasena) {
      const error = contrasenaValida(datos.data.contrasena);
      if (error) return reply.code(400).send({ error: 'contrasena_debil', mensaje: error });
      hash = await hashContrasena(datos.data.contrasena);
    }
    try {
      const { rows } = await pool.query(
        `insert into usuarios (email, nombre, hash_contrasena, rol) values ($1,$2,$3,$4) returning id`,
        [datos.data.email, datos.data.nombre, hash, datos.data.rol],
      );
      return { id: rows[0].id };
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        return reply.code(409).send({ error: 'email_existente' });
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/api/usuarias/:id',
    { preHandler: requerirAdmin(pool) },
    async (req, reply) => {
      const datos = z
        .object({
          activo: z.boolean().optional(),
          rol: z.enum(['admin', 'usuaria']).optional(),
          contrasena: z.string().optional(),
          quitar_mfa: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!datos.success || !z.string().uuid().safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'datos_invalidos' });
      }
      if (
        req.params.id === req.sesion!.usuario.id &&
        (datos.data.activo === false || datos.data.rol === 'usuaria')
      ) {
        return reply.code(400).send({ error: 'no_puede_degradarse_a_si_misma' });
      }
      const { activo, rol, contrasena, quitar_mfa } = datos.data;
      if (contrasena !== undefined) {
        const error = contrasenaValida(contrasena);
        if (error) return reply.code(400).send({ error: 'contrasena_debil', mensaje: error });
      }
      const hash = contrasena ? await hashContrasena(contrasena) : null;
      await pool.query(
        `update usuarios set
           activo = coalesce($2, activo),
           rol = coalesce($3, rol),
           hash_contrasena = coalesce($4, hash_contrasena),
           totp_activo = case when $5 then false else totp_activo end,
           totp_secreto = case when $5 then null else totp_secreto end,
           intentos_fallidos = case when $4::text is not null then 0 else intentos_fallidos end,
           bloqueado_hasta = case when $4::text is not null then null else bloqueado_hasta end
         where id = $1`,
        [req.params.id, activo ?? null, rol ?? null, hash, quitar_mfa === true],
      );
      if (activo === false || hash)
        await pool.query('delete from sesiones where usuario_id = $1', [req.params.id]);
      return { ok: true };
    },
  );

  // ---------- OAuth ----------
  const cookieTemporal = { path: '/api/auth', httpOnly: true, secure: seguro, maxAge: 600 };

  async function iniciarSesionExterna(
    reply: FastifyReply,
    proveedor: 'google' | 'apple',
    id: IdentidadExterna,
  ) {
    const columna = proveedor === 'google' ? 'google_sub' : 'apple_sub';
    let { rows } = await pool.query<FilaUsuario>(`select * from usuarios where ${columna} = $1`, [
      id.sub,
    ]);
    if (rows.length === 0 && id.email && id.emailVerificado) {
      // Solo se vinculan cuentas cuyo correo ya fue dado de alta por administración
      ({ rows } = await pool.query<FilaUsuario>(
        `update usuarios set ${columna} = $2 where email = $1 and ${columna} is null returning *`,
        [id.email, id.sub],
      ));
    }
    const u = rows[0];
    if (!u || !u.activo) return reply.redirect('/login?error=cuenta_no_autorizada');
    await crearSesion(pool, reply, u.id, opcionesSesion(u.totp_activo));
    return reply.redirect(u.totp_activo ? '/login?mfa=1' : '/');
  }

  app.get('/api/auth/google', async (_req, reply) => {
    if (!cfg.google) return reply.code(404).send({ error: 'google_no_configurado' });
    const estado = aleatorioUrl();
    const nonce = aleatorioUrl();
    const verificador = aleatorioUrl(48);
    reply.setCookie('oauth_g', JSON.stringify({ estado, nonce, verificador }), {
      ...cookieTemporal,
      sameSite: 'lax',
    });
    return reply.redirect(urlAutorizacionGoogle(cfg, estado, nonce, verificador));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/google/callback',
    async (req, reply) => {
      if (!cfg.google) return reply.code(404).send();
      const guardado = leerCookieJson(req.cookies.oauth_g);
      reply.clearCookie('oauth_g', { path: '/api/auth' });
      if (!guardado || !req.query.code || req.query.state !== guardado.estado) {
        return reply.redirect('/login?error=oauth_estado');
      }
      try {
        const id = await canjearCodigoGoogle(
          cfg,
          req.query.code,
          guardado.verificador,
          guardado.nonce,
        );
        return await iniciarSesionExterna(reply, 'google', id);
      } catch (e) {
        req.log.warn({ err: e }, 'fallo login google');
        return reply.redirect('/login?error=oauth_google');
      }
    },
  );

  app.get('/api/auth/apple', async (_req, reply) => {
    if (!cfg.apple) return reply.code(404).send({ error: 'apple_no_configurado' });
    const estado = aleatorioUrl();
    const nonce = aleatorioUrl();
    // Apple responde con un POST entre sitios: la cookie necesita SameSite=None (y Secure)
    reply.setCookie('oauth_a', JSON.stringify({ estado, nonce }), {
      ...cookieTemporal,
      sameSite: seguro ? 'none' : 'lax',
    });
    return reply.redirect(urlAutorizacionApple(cfg, estado, nonce));
  });

  app.post<{ Body: { code?: string; state?: string } }>(
    '/api/auth/apple/callback',
    async (req, reply) => {
      if (!cfg.apple) return reply.code(404).send();
      const guardado = leerCookieJson(req.cookies.oauth_a);
      reply.clearCookie('oauth_a', { path: '/api/auth' });
      if (!guardado || !req.body?.code || req.body.state !== guardado.estado) {
        return reply.redirect('/login?error=oauth_estado', 303);
      }
      try {
        const id = await canjearCodigoApple(cfg, req.body.code, guardado.nonce);
        reply.code(303);
        return await iniciarSesionExterna(reply, 'apple', id);
      } catch (e) {
        req.log.warn({ err: e }, 'fallo login apple');
        return reply.redirect('/login?error=oauth_apple', 303);
      }
    },
  );
}

function leerCookieJson(valor: string | undefined): Record<string, string> | null {
  if (!valor) return null;
  try {
    return JSON.parse(valor);
  } catch {
    return null;
  }
}
