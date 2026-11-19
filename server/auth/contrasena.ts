import bcrypt from 'bcryptjs';

const COSTE = 12;

export function hashContrasena(contrasena: string): Promise<string> {
  return bcrypt.hash(contrasena, COSTE);
}

let hashFicticio: string | null = null;

export function verificarContrasena(contrasena: string, hash: string | null): Promise<boolean> {
  // Siempre se compara contra un hash para no revelar por tiempo si el usuario existe
  hashFicticio ??= bcrypt.hashSync('contrasena-ficticia', COSTE);
  return bcrypt.compare(contrasena, hash ?? hashFicticio).then((ok) => ok && hash !== null);
}

export function contrasenaValida(c: string): string | null {
  if (c.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (c.length > 200) return 'La contraseña es demasiado larga';
  return null;
}
