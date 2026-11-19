import { z } from 'zod';
import { PATRON_LOTE } from './lote.js';
import type { Permisos } from './permisos.js';

const uuid = z.string().uuid();
const fechaIso = z.string().datetime({ offset: true });

export const productoEsquema = z.object({
  id: uuid,
  nombre: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).nullable().optional(),
  talla: z.string().trim().max(30).nullable().optional(),
  color: z.string().trim().max(50).nullable().optional(),
  precio: z.number().nonnegative().max(9_999_999_999).nullable().optional(),
  stock_minimo: z.number().int().min(0).max(1_000_000).default(2),
  creado_en: fechaIso,
  actualizado_en: fechaIso,
  eliminado: z.boolean().default(false),
});

export const loteEsquema = z.object({
  id: uuid,
  codigo: z.string().regex(PATRON_LOTE),
  producto_id: uuid,
  creado_en: fechaIso,
});

export const movimientoEsquema = z.object({
  id: uuid,
  lote_id: uuid,
  tipo: z.enum(['entrada', 'salida']),
  cantidad: z.number().int().positive().max(1_000_000),
  nota: z.string().max(500).nullable().optional(),
  precio_unitario: z.number().nonnegative().max(9_999_999_999).nullable().optional(),
  ocurrido_en: fechaIso,
  eliminado: z.boolean().default(false),
});

export const anulacionEsquema = z.object({ id: uuid });

export const cambioEsquema = z.discriminatedUnion('tabla', [
  z.object({
    id: z.number().int(),
    tabla: z.literal('productos'),
    operacion: z.literal('upsert'),
    payload: z.unknown(),
  }),
  z.object({
    id: z.number().int(),
    tabla: z.literal('lotes'),
    operacion: z.literal('insertar'),
    payload: z.unknown(),
  }),
  z.object({
    id: z.number().int(),
    tabla: z.literal('movimientos'),
    operacion: z.enum(['insertar', 'anular']),
    payload: z.unknown(),
  }),
]);

export const pushEsquema = z.object({ cambios: z.array(cambioEsquema).max(200) });

export type Producto = z.infer<typeof productoEsquema> & { creado_por?: string };
export type Lote = z.infer<typeof loteEsquema> & { creado_por?: string };
export type Movimiento = z.infer<typeof movimientoEsquema> & { usuario_id?: string };
export interface Imagen {
  id: string;
  producto_id: string;
  ruta: string;
  creado_en: string;
  eliminado: boolean;
}

export type ResultadoCambio =
  | { id: number; estado: 'ok' }
  | { id: number; estado: 'reintentar'; mensaje: string }
  | { id: number; estado: 'permanente'; mensaje: string };

export interface RespuestaPull {
  productos: Producto[];
  lotes: Lote[];
  movimientos: Movimiento[];
  imagenes: Imagen[];
  cursor: number;
  hayMas: boolean;
}

export interface UsuarioPublico {
  id: string;
  email: string;
  nombre: string;
  es_propietario: boolean;
  debe_cambiar_contrasena: boolean;
  mfa_activo: boolean;
  permisos: Permisos;
}
