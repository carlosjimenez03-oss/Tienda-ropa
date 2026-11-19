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
  /** Cuenta propietaria que se crea si la base no tiene usuarios */
  adminEmail?: string;
  adminContrasena?: string;
  diasSesion: number;
  /** Intentos de login por minuto y por IP */
  limiteLogin: number;
}

export function leerConfig(): Config {
  const databaseUrl = opcional('DATABASE_URL');
  if (!databaseUrl) throw new Error('Falta DATABASE_URL');
  const urlPublica = (opcional('PUBLIC_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  return {
    puerto: Number(opcional('PORT') ?? 3000),
    databaseUrl,
    urlPublica,
    produccion: process.env.NODE_ENV === 'production',
    directorioSubidas: opcional('UPLOADS_DIR') ?? './data/uploads',
    directorioEstatico: opcional('STATIC_DIR') ?? './dist',
    adminEmail: opcional('ADMIN_EMAIL')?.toLowerCase(),
    adminContrasena: opcional('ADMIN_PASSWORD'),
    diasSesion: Number(opcional('SESSION_DAYS') ?? 90),
    limiteLogin: Number(opcional('LOGIN_RATE_LIMIT') ?? 10),
  };
}
