import { api, ErrorApi } from '../api';
import { db, type ItemOutbox } from '../db/local';
import { backoff, pendientesListos } from '../db/outbox';
import type { ResultadoCambio } from '../../shared/esquemas';

const MAX_INTENTOS = 25;
const TAMANO_LOTE = 100;
export const CACHE_IMAGENES = 'imagenes-productos';

async function marcarReintento(item: ItemOutbox, mensaje: string) {
  const intentos = item.intentos + 1;
  await db.outbox.update(item.id!, {
    intentos,
    error: mensaje,
    proximo_intento: Date.now() + backoff(intentos),
    estado: intentos >= MAX_INTENTOS ? 'error' : 'pendiente',
  });
}

async function subirImagen(item: ItemOutbox): Promise<void> {
  const { id, producto_id } = item.payload as { id: string; producto_id: string };
  const local = await db.imagenes_locales.get(id);
  if (!local) {
    await db.outbox.delete(item.id!);
    return;
  }
  try {
    const r = await api<{ ruta: string }>(`/api/imagenes/${id}?producto_id=${producto_id}`, {
      method: 'PUT',
      raw: local.blob,
    });
    // Se guarda la imagen en la caché del service worker con su URL remota,
    // así sigue disponible sin conexión aunque se borre el blob local.
    try {
      if ('caches' in globalThis) {
        const cache = await caches.open(CACHE_IMAGENES);
        await cache.put(
          new Request(new URL(`/api/imagenes/${id}`, location.origin).href),
          new Response(local.blob, { headers: { 'content-type': local.blob.type } }),
        );
      }
    } catch {
      /* la caché es opcional */
    }
    await db.transaction('rw', [db.imagenes, db.imagenes_locales, db.outbox], async () => {
      await db.imagenes.update(id, { ruta: r.ruta, pendiente: false });
      await db.imagenes_locales.delete(id);
      await db.outbox.delete(item.id!);
    });
  } catch (e) {
    if (e instanceof ErrorApi && e.estado === 409)
      return marcarReintento(item, 'producto aún no sincronizado');
    if (e instanceof ErrorApi && (e.estado === 400 || e.estado === 413 || e.estado === 415)) {
      await db.outbox.update(item.id!, { estado: 'error', error: e.message });
      return;
    }
    throw e;
  }
}

/** Sube la outbox. Devuelve cuántos cambios se confirmaron. Lanza si no hay red. */
export async function push(): Promise<number> {
  let confirmados = 0;
  // Cada vuelta borra, marca como error o pospone (proximo_intento) cada elemento,
  // así que el bucle termina cuando no quedan elementos listos.
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    const listos = await pendientesListos();
    if (listos.length === 0) break;
    const datos = listos.filter((i) => i.tabla !== 'imagenes').slice(0, TAMANO_LOTE);
    const imagenes = listos.filter((i) => i.tabla === 'imagenes');

    if (datos.length > 0) {
      const { resultados } = await api<{ resultados: ResultadoCambio[] }>('/api/sync/push', {
        body: {
          cambios: datos.map((i) => ({
            id: i.id,
            tabla: i.tabla,
            operacion: i.operacion,
            payload: i.payload,
          })),
        },
      });
      const porId = new Map(datos.map((i) => [i.id!, i]));
      for (const r of resultados) {
        const item = porId.get(r.id);
        if (!item) continue;
        if (r.estado === 'ok') {
          await db.outbox.delete(r.id);
          confirmados++;
        } else if (r.estado === 'permanente') {
          await db.outbox.update(r.id, { estado: 'error', error: r.mensaje });
        } else {
          await marcarReintento(item, r.mensaje);
        }
      }
    }
    for (const img of imagenes) {
      await subirImagen(img);
      confirmados++;
    }
  }
  return confirmados;
}
