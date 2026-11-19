import { randomBytes, createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8 } from 'jose';
import type { Config } from '../config.js';

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export interface IdentidadExterna {
  sub: string;
  email: string | null;
  emailVerificado: boolean;
}

export function aleatorioUrl(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function desafioPkce(verificador: string): string {
  return createHash('sha256').update(verificador).digest('base64url');
}

// ---------- Google ----------

export function urlAutorizacionGoogle(
  cfg: Config,
  estado: string,
  nonce: string,
  verificador: string,
): string {
  const p = new URLSearchParams({
    client_id: cfg.google!.clientId,
    redirect_uri: `${cfg.urlPublica}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state: estado,
    nonce,
    code_challenge: desafioPkce(verificador),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function canjearCodigoGoogle(
  cfg: Config,
  codigo: string,
  verificador: string,
  nonce: string,
): Promise<IdentidadExterna> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: codigo,
      client_id: cfg.google!.clientId,
      client_secret: cfg.google!.clientSecret,
      redirect_uri: `${cfg.urlPublica}/api/auth/google/callback`,
      grant_type: 'authorization_code',
      code_verifier: verificador,
    }),
  });
  if (!r.ok) throw new Error(`Google rechazó el código (${r.status})`);
  const datos = (await r.json()) as { id_token?: string };
  if (!datos.id_token) throw new Error('Google no devolvió id_token');
  const { payload } = await jwtVerify(datos.id_token, googleJwks, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: cfg.google!.clientId,
  });
  if (payload.nonce !== nonce) throw new Error('nonce inválido');
  return {
    sub: String(payload.sub),
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    emailVerificado: payload.email_verified === true,
  };
}

// ---------- Apple ----------

export function urlAutorizacionApple(cfg: Config, estado: string, nonce: string): string {
  const p = new URLSearchParams({
    client_id: cfg.apple!.clientId,
    redirect_uri: `${cfg.urlPublica}/api/auth/apple/callback`,
    response_type: 'code',
    response_mode: 'form_post',
    scope: 'name email',
    state: estado,
    nonce: desafioPkce(nonce), // Apple compara contra el valor enviado; enviamos el hash
  });
  return `https://appleid.apple.com/auth/authorize?${p}`;
}

async function secretoClienteApple(cfg: Config): Promise<string> {
  const clave = await importPKCS8(cfg.apple!.privateKey, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: cfg.apple!.keyId })
    .setIssuer(cfg.apple!.teamId)
    .setSubject(cfg.apple!.clientId)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(clave);
}

export async function canjearCodigoApple(
  cfg: Config,
  codigo: string,
  nonce: string,
): Promise<IdentidadExterna> {
  const r = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.apple!.clientId,
      client_secret: await secretoClienteApple(cfg),
      code: codigo,
      grant_type: 'authorization_code',
      redirect_uri: `${cfg.urlPublica}/api/auth/apple/callback`,
    }),
  });
  if (!r.ok) throw new Error(`Apple rechazó el código (${r.status})`);
  const datos = (await r.json()) as { id_token?: string };
  if (!datos.id_token) throw new Error('Apple no devolvió id_token');
  const { payload } = await jwtVerify(datos.id_token, appleJwks, {
    issuer: 'https://appleid.apple.com',
    audience: cfg.apple!.clientId,
  });
  if (payload.nonce !== desafioPkce(nonce)) throw new Error('nonce inválido');
  const verificado = payload.email_verified === true || payload.email_verified === 'true';
  return {
    sub: String(payload.sub),
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    emailVerificado: verificado,
  };
}
