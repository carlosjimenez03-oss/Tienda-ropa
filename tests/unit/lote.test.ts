import { describe, expect, it } from 'vitest';
import {
  ALFABETO_LOTE,
  esCodigoLoteValido,
  generarCodigoLote,
  PATRON_LOTE,
} from '../../shared/lote';

describe('generarCodigoLote', () => {
  it('cumple el formato AAAAMMDD-XXXX', () => {
    for (let i = 0; i < 500; i++) expect(generarCodigoLote()).toMatch(PATRON_LOTE);
  });

  it('usa la fecha de Santo Domingo', () => {
    // 2026-03-01 02:00 UTC = 2026-02-28 22:00 en Santo Domingo (UTC-4)
    expect(generarCodigoLote(new Date('2026-03-01T02:00:00Z')).slice(0, 8)).toBe('20260228');
  });

  it('no contiene caracteres ambiguos', () => {
    for (const ambiguo of ['0', 'O', '1', 'I', 'L']) expect(ALFABETO_LOTE).not.toContain(ambiguo);
    for (let i = 0; i < 2000; i++) expect(generarCodigoLote().slice(9)).not.toMatch(/[01OIL]/);
  });

  it('es estadísticamente único', () => {
    const n = 2000;
    const codigos = new Set(
      Array.from({ length: n }, () => generarCodigoLote(new Date('2026-05-05T12:00:00Z'))),
    );
    // 31^4 ≈ 923k combinaciones: con 2000 muestras se esperan ~2 colisiones
    expect(codigos.size).toBeGreaterThan(n - 15);
  });

  it('valida códigos', () => {
    expect(esCodigoLoteValido('20260101-ABCD')).toBe(true);
    expect(esCodigoLoteValido('20260101-AB0D')).toBe(false);
    expect(esCodigoLoteValido('2026010-ABCD')).toBe(false);
  });
});
