import { db, type ItemOutbox, type Operacion, type TablaSync } from './local';

/**
 * Encola un cambio pendiente de subir. Debe llamarse dentro de una transacción
 * Dexie que incluya db.outbox para que el dato y su cambio se guarden juntos.
 */
export async function encolar(
  operacion: Operacion,
  tabla: TablaSync,
  payload: unknown,
): Promise<number> {
  const item: ItemOutbox = {
    operacion,
    tabla,
    payload,
    intentos: 0,
    creado_en: new Date().toISOString(),
    estado: 'pendiente',
  };
  return (await db.outbox.add(item)) as number;
}

export function contarPendientes(): Promise<number> {
  return db.outbox.count();
}

export async function pendientesListos(ahora = Date.now()): Promise<ItemOutbox[]> {
  const items = await db.outbox.where('estado').equals('pendiente').sortBy('id');
  return items.filter((i) => !i.proximo_intento || i.proximo_intento <= ahora);
}

export function backoff(intentos: number): number {
  return Math.min(5_000 * 2 ** Math.max(intentos - 1, 0), 15 * 60_000);
}
