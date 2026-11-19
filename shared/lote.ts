/**
 * Código de lote: AAAAMMDD-XXXX
 * XXXX = 4 caracteres aleatorios de un alfabeto sin caracteres ambiguos
 * (sin 0/O, 1/I/L). La unicidad real la garantiza la restricción UNIQUE en
 * Postgres; el servidor regenera el código si hay colisión.
 */
export const ALFABETO_LOTE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PATRON_LOTE = /^[0-9]{8}-[A-Z2-9]{4}$/;
const ZONA = 'America/Santo_Domingo';

function fechaCompacta(fecha: Date): string {
  // en-CA produce AAAA-MM-DD
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
  return partes.replace(/-/g, '');
}

function aleatorio(n: number): string {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  // Rechazo de muestras para evitar sesgo de módulo
  const limite = 256 - (256 % ALFABETO_LOTE.length);
  for (let i = 0; i < n; i++) {
    let b = bytes[i];
    while (b >= limite) {
      const extra = new Uint8Array(1);
      globalThis.crypto.getRandomValues(extra);
      b = extra[0];
    }
    s += ALFABETO_LOTE[b % ALFABETO_LOTE.length];
  }
  return s;
}

export function generarCodigoLote(fecha: Date = new Date()): string {
  return `${fechaCompacta(fecha)}-${aleatorio(4)}`;
}

export function esCodigoLoteValido(codigo: string): boolean {
  return PATRON_LOTE.test(codigo) && [...codigo.slice(9)].every((c) => ALFABETO_LOTE.includes(c));
}
