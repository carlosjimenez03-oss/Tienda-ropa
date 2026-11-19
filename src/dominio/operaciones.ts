import { db } from '../db/local';
import { encolar } from '../db/outbox';
import { generarCodigoLote } from '../../shared/lote';
import { calcularStock } from '../../shared/stock';
import type { Lote, Movimiento, Producto } from '../../shared/esquemas';
import {
  validarMovimiento,
  validarPrecio,
  validarProducto,
  type DatosProducto,
} from './validaciones';

export function uuid(): string {
  return crypto.randomUUID();
}

export async function stockDeLote(loteId: string): Promise<number> {
  return calcularStock(await db.movimientos.where('lote_id').equals(loteId).toArray());
}

export async function crearProducto(
  datos: DatosProducto & {
    cantidadInicial: number;
    costoUnitario?: number | null;
    imagen?: Blob | null;
  },
): Promise<{ producto: Producto; lote: Lote }> {
  const limpio = validarProducto(datos);
  const costo = validarPrecio(datos.costoUnitario, 'El costo');
  if (!Number.isInteger(datos.cantidadInicial) || datos.cantidadInicial < 0) {
    throw new Error('La cantidad inicial debe ser un número entero de 0 o más');
  }
  const ahora = new Date().toISOString();
  const producto: Producto = {
    id: uuid(),
    ...limpio,
    creado_en: ahora,
    actualizado_en: ahora,
    eliminado: false,
  };
  const lote: Lote = {
    id: uuid(),
    codigo: generarCodigoLote(),
    producto_id: producto.id,
    creado_en: ahora,
  };

  await db.transaction(
    'rw',
    [db.productos, db.lotes, db.movimientos, db.imagenes, db.imagenes_locales, db.outbox],
    async () => {
      await db.productos.add(producto);
      await encolar('upsert', 'productos', producto);
      await db.lotes.add(lote);
      await encolar('insertar', 'lotes', lote);
      if (datos.cantidadInicial > 0) {
        const m: Movimiento = {
          id: uuid(),
          lote_id: lote.id,
          tipo: 'entrada',
          cantidad: datos.cantidadInicial,
          nota: 'Inventario inicial',
          precio_unitario: costo,
          ocurrido_en: ahora,
          eliminado: false,
        };
        await db.movimientos.add(m);
        await encolar('insertar', 'movimientos', m);
      }
      if (datos.imagen) await agregarImagenEnTransaccion(producto.id, datos.imagen);
    },
  );
  return { producto, lote };
}

async function agregarImagenEnTransaccion(productoId: string, blob: Blob) {
  const id = uuid();
  await db.imagenes_locales.add({ id, producto_id: productoId, blob });
  await db.imagenes.add({
    id,
    producto_id: productoId,
    ruta: '',
    creado_en: new Date().toISOString(),
    eliminado: false,
    pendiente: true,
  });
  await encolar('subir', 'imagenes', { id, producto_id: productoId });
}

export async function agregarImagen(productoId: string, blob: Blob) {
  await db.transaction('rw', [db.imagenes, db.imagenes_locales, db.outbox], () =>
    agregarImagenEnTransaccion(productoId, blob),
  );
}

export async function actualizarProducto(id: string, datos: DatosProducto): Promise<void> {
  const limpio = validarProducto(datos);
  await db.transaction('rw', [db.productos, db.outbox], async () => {
    const actual = await db.productos.get(id);
    if (!actual) throw new Error('Producto no encontrado');
    const nuevo: Producto = { ...actual, ...limpio, actualizado_en: new Date().toISOString() };
    await db.productos.put(nuevo);
    await encolar('upsert', 'productos', nuevo);
  });
}

export async function eliminarProducto(id: string): Promise<void> {
  await db.transaction('rw', [db.productos, db.outbox], async () => {
    const actual = await db.productos.get(id);
    if (!actual) return;
    const nuevo: Producto = {
      ...actual,
      eliminado: true,
      actualizado_en: new Date().toISOString(),
    };
    await db.productos.put(nuevo);
    await encolar('upsert', 'productos', nuevo);
  });
}

export async function crearLote(
  productoId: string,
  cantidadInicial: number,
  nota?: string,
): Promise<Lote> {
  if (!Number.isInteger(cantidadInicial) || cantidadInicial < 0)
    throw new Error('Cantidad inválida');
  const ahora = new Date().toISOString();
  const lote: Lote = {
    id: uuid(),
    codigo: generarCodigoLote(),
    producto_id: productoId,
    creado_en: ahora,
  };
  await db.transaction('rw', [db.lotes, db.movimientos, db.outbox], async () => {
    await db.lotes.add(lote);
    await encolar('insertar', 'lotes', lote);
    if (cantidadInicial > 0) {
      const m: Movimiento = {
        id: uuid(),
        lote_id: lote.id,
        tipo: 'entrada',
        cantidad: cantidadInicial,
        nota: nota || 'Entrada de lote nuevo',
        ocurrido_en: ahora,
        eliminado: false,
      };
      await db.movimientos.add(m);
      await encolar('insertar', 'movimientos', m);
    }
  });
  return lote;
}

export async function stockDeProducto(productoId: string): Promise<number> {
  const lotes = await db.lotes.where('producto_id').equals(productoId).primaryKeys();
  return calcularStock(await db.movimientos.where('lote_id').anyOf(lotes).toArray());
}

export interface ResultadoMovimiento {
  movimiento: Movimiento;
  producto: Producto;
  /** Unidades que quedan del producto (todos sus lotes) tras el movimiento. */
  stockProducto: number;
  /** true si esta venta dejó el producto en su mínimo o por debajo. */
  alertaStockBajo: boolean;
}

export async function registrarMovimiento(datos: {
  loteId: string;
  tipo: 'entrada' | 'salida';
  cantidad: number;
  nota?: string;
  /** Precio de venta (salida) o costo de compra (entrada) por unidad. En ventas, por defecto el del producto. */
  precioUnitario?: number | null;
}): Promise<ResultadoMovimiento> {
  validarMovimiento(datos);
  const precio = validarPrecio(
    datos.precioUnitario,
    datos.tipo === 'salida' ? 'El precio' : 'El costo',
  );
  return db.transaction('rw', [db.productos, db.lotes, db.movimientos, db.outbox], async () => {
    const lote = await db.lotes.get(datos.loteId);
    if (!lote) throw new Error('El lote no existe');
    const producto = await db.productos.get(lote.producto_id);
    if (!producto) throw new Error('El producto no existe');
    if (datos.tipo === 'salida') {
      const stock = await stockDeLote(datos.loteId);
      if (datos.cantidad > stock) {
        throw new Error(
          stock === 0 ? 'No quedan unidades de este producto' : `Solo quedan ${stock} unidades`,
        );
      }
    }
    const antes = await stockDeProducto(producto.id);
    const m: Movimiento = {
      id: uuid(),
      lote_id: datos.loteId,
      tipo: datos.tipo,
      cantidad: datos.cantidad,
      nota: datos.nota?.trim() || null,
      precio_unitario: precio ?? (datos.tipo === 'salida' ? (producto.precio ?? null) : null),
      ocurrido_en: new Date().toISOString(),
      eliminado: false,
    };
    await db.movimientos.add(m);
    await encolar('insertar', 'movimientos', m);
    const despues = antes + (datos.tipo === 'entrada' ? datos.cantidad : -datos.cantidad);
    return {
      movimiento: m,
      producto,
      stockProducto: despues,
      alertaStockBajo: datos.tipo === 'salida' && despues <= (producto.stock_minimo ?? 2),
    };
  });
}

export async function anularMovimiento(id: string): Promise<void> {
  await db.transaction('rw', [db.movimientos, db.outbox], async () => {
    const m = await db.movimientos.get(id);
    if (!m || m.eliminado) return;
    if (m.tipo === 'entrada') {
      const stock = await stockDeLote(m.lote_id);
      if (stock - m.cantidad < 0) {
        throw new Error('No se puede anular: el stock quedaría negativo');
      }
    }
    await db.movimientos.update(id, { eliminado: true });
    await encolar('anular', 'movimientos', { id });
  });
}
