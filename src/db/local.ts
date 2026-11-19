import Dexie, { type EntityTable } from 'dexie';
import type { Imagen, Lote, Movimiento, Producto } from '../../shared/esquemas';

export type TablaSync = 'productos' | 'lotes' | 'movimientos' | 'imagenes';
export type Operacion = 'upsert' | 'insertar' | 'anular' | 'subir';

export interface ItemOutbox {
  id?: number;
  operacion: Operacion;
  tabla: TablaSync;
  payload: unknown;
  intentos: number;
  creado_en: string;
  estado: 'pendiente' | 'error';
  error?: string;
  proximo_intento?: number;
}

export interface ImagenLocal {
  id: string;
  producto_id: string;
  blob: Blob;
}

export interface Meta {
  clave: string;
  valor: unknown;
}

export type ImagenFila = Imagen & { pendiente?: boolean };

export class BaseLocal extends Dexie {
  productos!: EntityTable<Producto, 'id'>;
  lotes!: EntityTable<Lote, 'id'>;
  movimientos!: EntityTable<Movimiento, 'id'>;
  imagenes!: EntityTable<ImagenFila, 'id'>;
  imagenes_locales!: EntityTable<ImagenLocal, 'id'>;
  outbox!: EntityTable<ItemOutbox, 'id'>;
  meta!: EntityTable<Meta, 'clave'>;

  constructor(nombre = 'inventario') {
    super(nombre);
    // Versión 1 del esquema local. Para cambiarlo, añadir this.version(2).stores({...}).upgrade(...)
    this.version(1).stores({
      productos: 'id, nombre, actualizado_en',
      lotes: 'id, codigo, producto_id',
      movimientos: 'id, lote_id, ocurrido_en',
      imagenes: 'id, producto_id',
      imagenes_locales: 'id, producto_id',
      outbox: '++id, estado, tabla',
      meta: 'clave',
    });
  }
}

export let db = new BaseLocal();

/** Solo para pruebas: usar otra base. */
export function usarBase(nueva: BaseLocal) {
  db = nueva;
}

export async function leerMeta<T>(clave: string): Promise<T | undefined> {
  return (await db.meta.get(clave))?.valor as T | undefined;
}

export async function guardarMeta(clave: string, valor: unknown): Promise<void> {
  await db.meta.put({ clave, valor });
}
