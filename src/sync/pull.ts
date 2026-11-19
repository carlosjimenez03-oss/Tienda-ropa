import { api } from '../api';
import { db, guardarMeta, leerMeta } from '../db/local';
import type { RespuestaPull } from '../../shared/esquemas';

export const CLAVE_CURSOR = 'ultimo_pull';

export async function aplicarPull(r: RespuestaPull): Promise<void> {
  await db.transaction(
    'rw',
    [db.productos, db.lotes, db.movimientos, db.imagenes, db.meta],
    async () => {
      // Productos: último gana por actualizado_en
      if (r.productos.length) {
        const locales = await db.productos.bulkGet(r.productos.map((p) => p.id));
        const ganadores = r.productos.filter((p, i) => {
          const l = locales[i];
          return !l || l.actualizado_en <= p.actualizado_en;
        });
        await db.productos.bulkPut(ganadores);
      }
      if (r.lotes.length) await db.lotes.bulkPut(r.lotes);
      if (r.movimientos.length) {
        // La anulación es monotónica: si cualquiera de los dos lados la tiene, gana.
        const locales = await db.movimientos.bulkGet(r.movimientos.map((m) => m.id));
        await db.movimientos.bulkPut(
          r.movimientos.map((m, i) => ({
            ...m,
            eliminado: m.eliminado || Boolean(locales[i]?.eliminado),
          })),
        );
      }
      if (r.imagenes.length) {
        await db.imagenes.bulkPut(r.imagenes.map((i) => ({ ...i, pendiente: false })));
      }
      await db.meta.put({ clave: CLAVE_CURSOR, valor: r.cursor });
    },
  );
}

export async function pull(): Promise<number> {
  let desde = (await leerMeta<number>(CLAVE_CURSOR)) ?? 0;
  let recibidos = 0;
  for (;;) {
    const r = await api<RespuestaPull>(`/api/sync/pull?desde=${desde}&limite=1000`);
    await aplicarPull(r);
    recibidos += r.productos.length + r.lotes.length + r.movimientos.length + r.imagenes.length;
    desde = r.cursor;
    if (!r.hayMas) break;
  }
  await guardarMeta('ultimo_sync', new Date().toISOString());
  return recibidos;
}
