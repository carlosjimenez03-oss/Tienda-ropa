export interface MovimientoStock {
  tipo: 'entrada' | 'salida';
  cantidad: number;
  eliminado?: boolean;
}

/** Stock = suma(entradas) - suma(salidas) sobre movimientos no anulados. */
export function calcularStock(movimientos: Iterable<MovimientoStock>): number {
  let total = 0;
  for (const m of movimientos) {
    if (m.eliminado) continue;
    total += m.tipo === 'entrada' ? m.cantidad : -m.cantidad;
  }
  return total;
}

/** Agrupa stock por lote_id. */
export function stockPorLote<T extends MovimientoStock & { lote_id: string }>(
  movimientos: Iterable<T>,
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const m of movimientos) {
    if (m.eliminado) continue;
    mapa.set(
      m.lote_id,
      (mapa.get(m.lote_id) ?? 0) + (m.tipo === 'entrada' ? m.cantidad : -m.cantidad),
    );
  }
  return mapa;
}
