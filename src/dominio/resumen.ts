import type { Lote, Movimiento, Producto } from '../../shared/esquemas';

export type Periodo = 'hoy' | '7d' | 'mes' | '30d';

export const NOMBRES_PERIODO: Record<Periodo, string> = {
  hoy: 'Hoy',
  '7d': '7 días',
  mes: 'Este mes',
  '30d': '30 días',
};

const ZONA = 'America/Santo_Domingo';
const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Día local de Santo Domingo en formato AAAA-MM-DD. */
export function diaLocal(fecha: Date | string): string {
  return formatoDia.format(typeof fecha === 'string' ? new Date(fecha) : fecha);
}

/** Lista de días (AAAA-MM-DD) que abarca el periodo, del más antiguo al más reciente. */
export function diasDelPeriodo(periodo: Periodo, ahora = new Date()): string[] {
  const hoy = diaLocal(ahora);
  let n: number;
  if (periodo === 'hoy') n = 1;
  else if (periodo === '7d') n = 7;
  else if (periodo === '30d') n = 30;
  else n = Number(hoy.slice(8, 10));
  const dias: string[] = [];
  // Mediodía UTC evita saltos de día por la zona horaria
  const base = new Date(`${hoy}T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    dias.push(new Date(base.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return dias;
}

export interface DiaVentas {
  dia: string;
  monto: number;
  unidades: number;
}

export interface TopProducto {
  producto: Producto;
  unidades: number;
  monto: number;
}

export interface Resumen {
  vendido: { unidades: number; monto: number; ventas: number };
  comprado: { unidades: number; monto: number; sinCosto: number };
  porDia: DiaVentas[];
  masVendidos: TopProducto[];
}

export function calcularResumen(
  datos: { productos: Producto[]; lotes: Lote[]; movimientos: Movimiento[] },
  periodo: Periodo,
  ahora = new Date(),
): Resumen {
  const dias = diasDelPeriodo(periodo, ahora);
  const enPeriodo = new Set(dias);
  const productoPorLote = new Map(datos.lotes.map((l) => [l.id, l.producto_id]));
  const productos = new Map(datos.productos.map((p) => [p.id, p]));
  const porDia = new Map<string, DiaVentas>(
    dias.map((d) => [d, { dia: d, monto: 0, unidades: 0 }]),
  );
  const top = new Map<string, TopProducto>();
  const r: Resumen = {
    vendido: { unidades: 0, monto: 0, ventas: 0 },
    comprado: { unidades: 0, monto: 0, sinCosto: 0 },
    porDia: [],
    masVendidos: [],
  };

  for (const m of datos.movimientos) {
    if (m.eliminado) continue;
    const dia = diaLocal(m.ocurrido_en);
    if (!enPeriodo.has(dia)) continue;
    const monto = (m.precio_unitario ?? 0) * m.cantidad;
    if (m.tipo === 'salida') {
      r.vendido.unidades += m.cantidad;
      r.vendido.monto += monto;
      r.vendido.ventas += 1;
      const d = porDia.get(dia)!;
      d.unidades += m.cantidad;
      d.monto += monto;
      const pid = productoPorLote.get(m.lote_id);
      const producto = pid ? productos.get(pid) : undefined;
      if (producto) {
        const t = top.get(producto.id) ?? { producto, unidades: 0, monto: 0 };
        t.unidades += m.cantidad;
        t.monto += monto;
        top.set(producto.id, t);
      }
    } else {
      r.comprado.unidades += m.cantidad;
      if (m.precio_unitario == null) r.comprado.sinCosto += 1;
      else r.comprado.monto += monto;
    }
  }
  r.porDia = dias.map((d) => porDia.get(d)!);
  r.masVendidos = [...top.values()]
    .sort((a, b) => b.unidades - a.unidades || b.monto - a.monto)
    .slice(0, 5);
  return r;
}
