import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Pool } from '../db.js';
import { contrasenaValida, hashContrasena, verificarContrasena } from './contrasena.js';
import {
  cerrarSesion,
  crearSesion,
  leerSesion,
  usuarioPublico,
  type FilaUsuario,
  type SesionActual,
} from './sesiones.js';
import { nuevoSecreto, totpPara, verificarCodigo } from './totp.js';
import {
  PERMISOS,
  PERMISOS_POR_DEFECTO,
  type Permiso,
  type Permisos,
} from '../../shared/permisos.js';

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

declare module 'fastify' {
  interface FastifyRequest {
    sesion?: SesionActual;
  }
}

export function permisosDe(u: FilaUsuario): Permisos {
  return usuarioPublico(u).permisos;
}

/** Contraseña temporal fácil de dictar: 3 grupos de 4 caracteres sin ambiguos. */
export function contrasenaTemporal(): string {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789';
  const grupo = () =>
    Array.from({ length: 4 }, () => alfabeto[randomInt(alfabeto.length)]).join('');
  return `${grupo()}-${grupo()}-${grupo()}`;
}

/**
 * Exige sesión válida. Si la persona tiene pendiente cambiar la contraseña solo
 * puede usar las rutas marcadas con `permitirCambioPendiente`.
 */
export function requerirSesion(
  pool: Pool,
  opciones: { permiso?: Permiso; permitirCambioPendiente?: boolean } = {},
) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const sesion = await leerSesion(pool, req);
    if (!sesion || sesion.mfaPendiente) {
      return reply.code(401).send({ error: 'sesion_requerida' });
    }
    if (sesion.usuario.debe_cambiar_contrasena && !opciones.permitirCambioPendiente) {
      return reply.code(403).send({ error: 'debe_cambiar_contrasena' });
    }
    if (opciones.permiso && !permisosDe(sesion.usuario)[opciones.permiso]) {
      return reply.code(403).send({ error: 'sin_permiso' });
    }
    req.sesion = sesion;
  };
}

const loginEsquema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  contrasena: z.string().min(1).max(200),
});
const codigoEsquema = z.object({ codigo: z.string().trim().min(6).max(10) });
const permisosEsquema = z
  .object(Object.fromEntries(PERMISOS.map((p) => [p, z.boolean().optional()])))
  .partial();
const nuevoUsuarioEsquema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  nombre: z.string().trim().max(120).default(''),
  permisos: permisosEsquema.default({}),
});
const cambioUsuarioEsquema = z.object({
  activo: z.boolean().optional(),
  nombre: z.string().trim().max(120).optional(),
  permisos: permisosEsquema.optional(),
  restablecer_contrasena: z.boolean().optional(),
  quitar_mfa: z.boolean().optional(),
});
const cambioContrasenaEsquema = z.object({
  actual: z.string().max(200),
  nueva: z.string(),
});

/** Crea la cuenta propietaria (todos los permisos) si la base no tiene usuarios. */
export async function asegurarAdminInicial(pool: Pool, cfg: Config, log: (m: string) => void) {
  if (!cfg.adminEmail || !cfg.adminContrasena) return;
  const { rows } = await pool.query('select count(*)::int as n from usuarios');
  if (rows[0].n > 0) return;
  const error = contrasenaValida(cfg.adminContrasena);
  if (error) throw new Error(`ADMIN_PASSWORD inválida: ${error}`);
  await pool.query(
    `insert into usuarios (email, nombre, hash_contrasena, es_propietario, debe_cambiar_contrasena,
       puede_vender, puede_agregar_mercancia, puede_editar_productos, puede_ver_resumen, puede_crear_usuarios)
     values ($1, 'Propietario', $2, true, true, true, true, true, true, true)`,
    [cfg.adminEmail, await hashContrasena(cfg.adminContrasena)],
  );
  log(`cuenta propietaria creada: ${cfg.adminEmail} (debe cambiar la contraseña al entrar)`);
}

export async function rutasAuth(app: FastifyInstance, opts: { pool: Pool; cfg: Config }) {
  const { pool, cfg } = opts;
  // La cookie es "Secure" cuando la visita llega por HTTPS (Traefik informa el
  // protocolo original), sin depender de que PUBLIC_URL esté bien escrita.
  const opcionesSesion = (req: FastifyRequest, mfaPendiente: boolean) => ({
    mfaPendiente,
    dias: cfg.diasSesion,
    seguro: req.protocol === 'https',
  });
  const limiteLogin = { config: { rateLimit: { max: cfg.limiteLogin, timeWindow: '1 minute' } } };
  const conSesion = requerirSesion(pool);
  const conSesionPendiente = requerirSesion(pool, { permitirCambioPendiente: true });
  const gestionUsuarios = requerirSesion(pool, { permiso: 'puede_crear_usuarios' });

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
    await crearSesion(pool, reply, u.id, opcionesSesion(req, u.totp_activo));
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
    await crearSesion(pool, reply, u.id, opcionesSesion(req, false));
    return { usuario: usuarioPublico(u) };
  });

  app.post('/api/auth/salir', async (req, reply) => {
    await cerrarSesion(pool, req, reply);
    return { ok: true };
  });

  app.post('/api/auth/contrasena', { preHandler: conSesionPendiente }, async (req, reply) => {
    const u = req.sesion!.usuario;
    const datos = cambioContrasenaEsquema.safeParse(req.body);
    if (!datos.success) return reply.code(400).send({ error: 'datos_invalidos' });
    const error = contrasenaValida(datos.data.nueva);
    if (error) return reply.code(400).send({ error: 'contrasena_debil', mensaje: error });
    if (!(await verificarContrasena(datos.data.actual, u.hash_contrasena))) {
      return reply.code(401).send({ error: 'contrasena_actual_incorrecta' });
    }
    if (datos.data.actual === datos.data.nueva) {
      return reply.code(400).send({ error: 'contrasena_repetida' });
    }
    const { rows } = await pool.query<FilaUsuario>(
      `update usuarios set hash_contrasena = $2, debe_cambiar_contrasena = false
        where id = $1 returning *`,
      [u.id, await hashContrasena(datos.data.nueva)],
    );
    // Cierra las demás sesiones
    await pool.query('delete from sesiones where usuario_id = $1 and id <> $2', [
      u.id,
      req.sesion!.tokenHash,
    ]);
    return { ok: true, usuario: usuarioPublico(rows[0]) };
  });

  // ---------- MFA (TOTP) ----------
  app.post('/api/auth/mfa/configurar', { preHandler: conSesion }, async (req) => {
    const u = req.sesion!.usuario;
    if (u.totp_activo) return { ya_activo: true };
    const secreto = nuevoSecreto();
    await pool.query('update usuarios set totp_secreto = $2 where id = $1', [u.id, secreto]);
    const uri = totpPara(secreto, u.email).toString();
    return { secreto, uri, qr: await QRCode.toDataURL(uri) };
  });

  app.post('/api/auth/mfa/activar', { preHandler: conSesion }, async (req, reply) => {
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

  app.post('/api/auth/mfa/desactivar', { preHandler: conSesion }, async (req, reply) => {
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

  // ---------- Usuarios y permisos ----------
  /**
   * Reglas:
   * - Solo quien tiene "crear usuarios" entra aquí.
   * - Solo se pueden dar permisos que uno mismo tiene (nadie se da más de lo que tiene).
   * - La cuenta propietaria gestiona a todos; el resto solo a quienes creó.
   * - Nadie puede cambiarse sus propios permisos ni desactivarse, y la propietaria no se toca.
   */
  function puedeGestionar(actor: FilaUsuario, objetivo: FilaUsuario): boolean {
    if (objetivo.es_propietario || objetivo.id === actor.id) return false;
    return actor.es_propietario || objetivo.creado_por === actor.id;
  }

  function validarPermisosConcedidos(
    actor: FilaUsuario,
    pedidos: Partial<Record<Permiso, boolean | undefined>>,
  ): Permiso | null {
    const propios = permisosDe(actor);
    for (const p of PERMISOS) if (pedidos[p] === true && !propios[p]) return p;
    return null;
  }

  app.get('/api/usuarios', { preHandler: gestionUsuarios }, async (req) => {
    const actor = req.sesion!.usuario;
    const { rows } = await pool.query(
      `select u.id, u.email, u.nombre, u.activo, u.es_propietario, u.totp_activo as mfa_activo,
              u.debe_cambiar_contrasena, u.creado_en, u.creado_por, c.email as creado_por_email,
              ${PERMISOS.map((p) => `u.${p}`).join(', ')}
         from usuarios u left join usuarios c on c.id = u.creado_por
        order by u.es_propietario desc, u.creado_en`,
    );
    return {
      usuarios: rows.map((r) => ({
        ...r,
        permisos: r.es_propietario
          ? Object.fromEntries(PERMISOS.map((p) => [p, true]))
          : Object.fromEntries(PERMISOS.map((p) => [p, r[p]])),
        gestionable: puedeGestionar(actor, r),
      })),
    };
  });

  app.post('/api/usuarios', { preHandler: gestionUsuarios }, async (req, reply) => {
    const actor = req.sesion!.usuario;
    const datos = nuevoUsuarioEsquema.safeParse(req.body);
    if (!datos.success) return reply.code(400).send({ error: 'datos_invalidos' });
    const pedidos = { ...PERMISOS_POR_DEFECTO, ...datos.data.permisos };
    const negado = validarPermisosConcedidos(actor, pedidos);
    if (negado) return reply.code(403).send({ error: 'permiso_no_concedible', permiso: negado });
    const temporal = contrasenaTemporal();
    try {
      const { rows } = await pool.query(
        `insert into usuarios (email, nombre, hash_contrasena, debe_cambiar_contrasena, creado_por,
           ${PERMISOS.join(', ')})
         values ($1, $2, $3, true, $4, ${PERMISOS.map((_, i) => `$${i + 5}`).join(', ')})
         returning id`,
        [
          datos.data.email,
          datos.data.nombre,
          await hashContrasena(temporal),
          actor.id,
          ...PERMISOS.map((p) => pedidos[p] === true),
        ],
      );
      return { id: rows[0].id, contrasena_temporal: temporal };
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        return reply.code(409).send({ error: 'email_existente' });
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/api/usuarios/:id',
    { preHandler: gestionUsuarios },
    async (req, reply) => {
      const actor = req.sesion!.usuario;
      const datos = cambioUsuarioEsquema.safeParse(req.body);
      if (!datos.success || !z.string().uuid().safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'datos_invalidos' });
      }
      const { rows } = await pool.query<FilaUsuario>('select * from usuarios where id = $1', [
        req.params.id,
      ]);
      const objetivo = rows[0];
      if (!objetivo) return reply.code(404).send({ error: 'no_encontrado' });
      if (!puedeGestionar(actor, objetivo)) return reply.code(403).send({ error: 'sin_permiso' });

      const { activo, nombre, permisos, restablecer_contrasena, quitar_mfa } = datos.data;
      if (permisos) {
        const negado = validarPermisosConcedidos(actor, permisos);
        if (negado)
          return reply.code(403).send({ error: 'permiso_no_concedible', permiso: negado });
      }
      const temporal = restablecer_contrasena ? contrasenaTemporal() : null;
      const valores: unknown[] = [req.params.id];
      const sets: string[] = [];
      const fijar = (columna: string, valor: unknown) => {
        valores.push(valor);
        sets.push(`${columna} = $${valores.length}`);
      };
      if (activo !== undefined) fijar('activo', activo);
      if (nombre !== undefined) fijar('nombre', nombre);
      if (permisos) for (const p of PERMISOS) if (permisos[p] !== undefined) fijar(p, permisos[p]);
      if (temporal) {
        fijar('hash_contrasena', await hashContrasena(temporal));
        fijar('debe_cambiar_contrasena', true);
        fijar('intentos_fallidos', 0);
        fijar('bloqueado_hasta', null);
      }
      if (quitar_mfa) {
        fijar('totp_activo', false);
        fijar('totp_secreto', null);
      }
      if (sets.length) {
        await pool.query(`update usuarios set ${sets.join(', ')} where id = $1`, valores);
      }
      if (activo === false || temporal) {
        await pool.query('delete from sesiones where usuario_id = $1', [req.params.id]);
      }
      return temporal ? { ok: true, contrasena_temporal: temporal } : { ok: true };
    },
  );
}
