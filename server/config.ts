function opcional(nombre: string): string | undefined {
  const v = process.env[nombre];
  return v && v.trim() !== '' ? v : undefined;
}

export interface Config {
  puerto: number;
  databaseUrl: string;
  urlPublica: string;
  produccion: boolean;
  directorioSubidas: string;
  directorioEstatico: string;
  adminEmail?: string;
  adminContrasena?: string;
  google?: { clientId: string; clientSecret: string };
  apple?: { clientId: string; teamId: string; keyId: string; privateKey: string };
  diasSesion: number;
  /** Intentos de login por minuto y por IP */
  limiteLogin: number;
}

export function leerConfig(): Config {
  const databaseUrl = opcional('DATABASE_URL');
  if (!databaseUrl) throw new Error('Falta DATABASE_URL');
  const urlPublica = (opcional('PUBLIC_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  const googleId = opcional('GOOGLE_CLIENT_ID');
  const googleSecret = opcional('GOOGLE_CLIENT_SECRET');
  const appleId = opcional('APPLE_CLIENT_ID');
  const appleTeam = opcional('APPLE_TEAM_ID');
  const appleKey = opcional('APPLE_KEY_ID');
  const applePk = opcional('APPLE_PRIVATE_KEY');
  return {
    puerto: Number(opcional('PORT') ?? 3000),
    databaseUrl,
    urlPublica,
    produccion: process.env.NODE_ENV === 'production',
    directorioSubidas: opcional('UPLOADS_DIR') ?? './data/uploads',
    directorioEstatico: opcional('STATIC_DIR') ?? './dist',
    adminEmail: opcional('ADMIN_EMAIL')?.toLowerCase(),
    adminContrasena: opcional('ADMIN_PASSWORD'),
    google:
      googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret } : undefined,
    apple:
      appleId && appleTeam && appleKey && applePk
        ? {
            clientId: appleId,
            teamId: appleTeam,
            keyId: appleKey,
            // Permite pegar la clave .p8 con "\n" literales en variables de entorno
            privateKey: applePk.replace(/\\n/g, '\n'),
          }
        : undefined,
    diasSesion: Number(opcional('SESSION_DAYS') ?? 90),
    limiteLogin: Number(opcional('LOGIN_RATE_LIMIT') ?? 10),
  };
}
