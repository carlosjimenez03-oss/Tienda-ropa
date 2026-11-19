import { describe, expect, it } from 'vitest';
import { calcularStock, stockPorLote } from '../../shared/stock';

describe('calcularStock', () => {
  it('suma entradas y resta salidas', () => {
    expect(
      calcularStock([
        { tipo: 'entrada', cantidad: 10 },
        { tipo: 'salida', cantidad: 3 },
        { tipo: 'salida', cantidad: 2 },
        { tipo: 'entrada', cantidad: 1 },
      ]),
    ).toBe(6);
  });

  it('ignora movimientos anulados', () => {
    expect(
      calcularStock([
        { tipo: 'entrada', cantidad: 10 },
        { tipo: 'salida', cantidad: 4, eliminado: true },
      ]),
    ).toBe(10);
  });

  it('es cero sin movimientos', () => {
    expect(calcularStock([])).toBe(0);
  });

  it('agrupa por lote', () => {
    const m = stockPorLote([
      { lote_id: 'a', tipo: 'entrada', cantidad: 5 },
      { lote_id: 'b', tipo: 'entrada', cantidad: 2 },
      { lote_id: 'a', tipo: 'salida', cantidad: 1 },
    ]);
    expect(m.get('a')).toBe(4);
    expect(m.get('b')).toBe(2);
  });
});
