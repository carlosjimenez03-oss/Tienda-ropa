import { db } from '../db/local';
import { stockPorLote } from '../../shared/stock';
import type { Lote, Producto } from '../../shared/esquemas';

export type EstadoStock = 'agotado' | 'por_acabarse' | 'ok';

export function estadoStock(stock: number, minimo: number): EstadoStock {
  if (stock <= 0) return 'agotado';
  if (stock <= minimo) return 'por_acabarse';
  return 'ok';
}

export interface FilaProducto {
  producto: Producto;
  lotes: Lote[];
  stock: number;
  /** Aviso cuando quedan esta cantidad o menos */
  minimo: number;
  estado: EstadoStock;
  imagenId?: string;
  /** Texto normalizado para buscar */
  indice: string;
}

export function normalizar(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Carga productos activos con su stock total y lotes, para la lista y la búsqueda. */
export async function cargarProductos(): Promise<FilaProducto[]> {
  const [productos, lotes, movimientos, imagenes] = await Promise.all([
    db.productos.toArray(),
    db.lotes.toArray(),
    db.movimientos.toArray(),
    db.imagenes.toArray(),
  ]);
  const stock = stockPorLote(movimientos);
  const lotesPorProducto = new Map<string, Lote[]>();
  for (const l of lotes) {
    const lista = lotesPorProducto.get(l.producto_id) ?? [];
    lista.push(l);
    lotesPorProducto.set(l.producto_id, lista);
  }
  const imagenPorProducto = new Map<string, string>();
  for (const i of imagenes)
    if (!i.eliminado && !imagenPorProducto.has(i.producto_id))
      imagenPorProducto.set(i.producto_id, i.id);

  return productos
    .filter((p) => !p.eliminado)
    .map((producto) => {
      const ls = (lotesPorProducto.get(producto.id) ?? []).sort((a, b) =>
        b.creado_en.localeCompare(a.creado_en),
      );
      const total = ls.reduce((s, l) => s + (stock.get(l.id) ?? 0), 0);
      const minimo = producto.stock_minimo ?? 2;
      return {
        producto,
        lotes: ls,
        stock: total,
        minimo,
        estado: estadoStock(total, minimo),
        imagenId: imagenPorProducto.get(producto.id),
        indice: normalizar(
          [
            producto.nombre,
            producto.sku,
            producto.talla,
            producto.color,
            ...ls.map((l) => l.codigo),
          ]
            .filter(Boolean)
            .join(' '),
        ),
      };
    })
    .sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es'));
}

export function filtrar(filas: FilaProducto[], consulta: string): FilaProducto[] {
  const terminos = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (terminos.length === 0) return filas;
  return filas.filter((f) => terminos.every((t) => f.indice.includes(t)));
}

export const formatoPrecio = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
export const formatoFecha = new Intl.DateTimeFormat('es-DO', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Santo_Domingo',
});
