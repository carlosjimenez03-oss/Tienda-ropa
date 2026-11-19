import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '../db.js';
import type { UsuarioPublico } from '../../shared/esquemas.js';

export const COOKIE_SESION = 'sid';

export interface FilaUsuario {
  id: string;
  email: string;
  nombre: string;
  rol: 'admin' | 'usuaria';
  activo: boolean;
  hash_contrasena: string | null;
  totp_secreto: string | null;
  totp_activo: boolean;
  intentos_fallidos: number;
  bloqueado_hasta: string | null;
}

export function usuarioPublico(u: FilaUsuario): UsuarioPublico {
  return { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, mfa_activo: u.totp_activo };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function crearSesion(
  pool: Pool,
  reply: FastifyReply,
  usuarioId: string,
  opciones: { mfaPendiente: boolean; dias: number; seguro: boolean },
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const dias = opciones.mfaPendiente ? 0.01 : opciones.dias; // ~15 min para completar MFA
  await pool.query(
    `insert into sesiones (id, usuario_id, mfa_pendiente, expira_en)
     values ($1, $2, $3, now() + make_interval(secs => $4))`,
    [hashToken(token), usuarioId, opciones.mfaPendiente, Math.round(dias * 86400)],
  );
  reply.setCookie(COOKIE_SESION, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: opciones.seguro,
    maxAge: Math.round(dias * 86400),
  });
}

export interface SesionActual {
  tokenHash: string;
  usuario: FilaUsuario;
  mfaPendiente: boolean;
}

export async function leerSesion(pool: Pool, req: FastifyRequest): Promise<SesionActual | null> {
  const token = req.cookies[COOKIE_SESION];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const { rows } = await pool.query(
    `select s.mfa_pendiente, s.ultimo_uso, u.*
       from sesiones s join usuarios u on u.id = s.usuario_id
      where s.id = $1 and s.expira_en > now() and u.activo`,
    [tokenHash],
  );
  if (rows.length === 0) return null;
  const fila = rows[0];
  // Renovación deslizante como mucho una vez por hora
  if (Date.now() - new Date(fila.ultimo_uso).getTime() > 3_600_000 && !fila.mfa_pendiente) {
    await pool.query(
      `update sesiones set ultimo_uso = now(),
         expira_en = greatest(expira_en, now() + interval '30 days') where id = $1`,
      [tokenHash],
    );
  }
  return { tokenHash, usuario: fila as FilaUsuario, mfaPendiente: fila.mfa_pendiente };
}

export async function cerrarSesion(pool: Pool, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[COOKIE_SESION];
  if (token) await pool.query('delete from sesiones where id = $1', [hashToken(token)]);
  reply.clearCookie(COOKIE_SESION, { path: '/' });
}
