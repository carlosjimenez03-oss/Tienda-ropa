import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/local';
import { anularMovimiento, registrarMovimiento } from '../dominio/operaciones';
import { cargarProductos, filtrar, formatoFecha, normalizar } from '../dominio/consultas';
import { stockPorLote } from '../../shared/stock';
import { programarSync } from '../sync/engine';

export function Movimientos() {
  const [params, setParams] = useSearchParams();
  const tipo = params.get('tipo') === 'entrada' ? 'entrada' : 'salida';
  const productos = useLiveQuery(cargarProductos, []);
  const stocks = useLiveQuery(async () => stockPorLote(await db.movimientos.toArray()), []);
  const recientes = useLiveQuery(
    () => db.movimientos.orderBy('ocurrido_en').reverse().limit(50).toArray(),
    [],
  );

  const [busqueda, setBusqueda] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [nota, setNota] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  // Lote elegido: por parámetro ?lote=, o el más reciente con stock de ?producto=
  const loteId = useMemo(() => {
    const directo = params.get('lote');
    if (directo) return directo;
    const pid = params.get('producto');
    const fila = productos?.find((f) => f.producto.id === pid);
    if (!fila) return null;
    return (fila.lotes.find((l) => (stocks?.get(l.id) ?? 0) > 0) ?? fila.lotes[0])?.id ?? null;
  }, [params, productos, stocks]);

  const indiceLotes = useMemo(() => {
    const m = new Map<string, { codigo: string; nombre: string; detalle: string }>();
    for (const f of productos ?? [])
      for (const l of f.lotes)
        m.set(l.id, {
          codigo: l.codigo,
          nombre: f.producto.nombre,
          detalle: [f.producto.talla, f.producto.color].filter(Boolean).join(' · '),
        });
    return m;
  }, [productos]);

  const elegido = loteId ? indiceLotes.get(loteId) : undefined;
  const stockElegido = loteId ? (stocks?.get(loteId) ?? 0) : 0;

  const candidatos = useMemo(() => {
    if (!productos || !busqueda.trim()) return [];
    const q = normalizar(busqueda.trim());
    return filtrar(productos, busqueda)
      .flatMap((f) => {
        // Si la búsqueda coincide con un código de lote concreto, se muestra solo ese lote
        const porCodigo = f.lotes.filter((l) => normalizar(l.codigo).includes(q));
        return (porCodigo.length ? porCodigo : f.lotes).map((l) => ({ lote: l, fila: f }));
      })
      .slice(0, 20);
  }, [productos, busqueda]);

  function fijar(cambios: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  }

  async function registrar(e: FormEvent) {
    e.preventDefault();
    if (!loteId) return;
    setAviso(null);
    try {
      await registrarMovimiento({ loteId, tipo, cantidad, nota });
      programarSync();
      setAviso({
        ok: true,
        texto: `${tipo === 'salida' ? 'Venta' : 'Entrada'} registrada: ${cantidad} × ${elegido?.nombre}`,
      });
      setCantidad(1);
      setNota('');
    } catch (err) {
      setAviso({ ok: false, texto: (err as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Movimientos</h1>

      <form onSubmit={registrar} className="tarjeta space-y-4">
        <div
          className="grid grid-cols-2 gap-2 rounded-xl bg-stone-100 p-1"
          role="radiogroup"
          aria-label="Tipo"
        >
          {(['salida', 'entrada'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tipo === t}
              onClick={() => fijar({ tipo: t })}
              className={`min-h-12 rounded-lg font-semibold ${
                tipo === t
                  ? t === 'salida'
                    ? 'bg-marca-700 text-white'
                    : 'bg-emerald-600 text-white'
                  : 'text-stone-600'
              }`}
            >
              {t === 'salida' ? 'Venta (salida)' : 'Entrada'}
            </button>
          ))}
        </div>

        {elegido ? (
          <div className="flex items-center gap-3 rounded-xl border border-stone-200 p-3">
            <div className="flex-1">
              <div className="font-semibold">{elegido.nombre}</div>
              <div className="text-sm text-stone-500">
                <span className="font-mono">{elegido.codigo}</span>
                {elegido.detalle && ` · ${elegido.detalle}`} · <strong>{stockElegido}</strong> en
                stock
              </div>
            </div>
            <button
              type="button"
              className="text-sm text-marca-700 underline"
              onClick={() => fijar({ lote: null, producto: null })}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <div>
            <label className="etiqueta" htmlFor="buscar-lote">
              Producto o código de lote
            </label>
            <input
              id="buscar-lote"
              className="campo"
              type="search"
              placeholder="Escribe para buscar…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              autoComplete="off"
            />
            {candidatos.length > 0 && (
              <ul className="mt-2 max-h-72 divide-y divide-stone-100 overflow-auto rounded-xl border border-stone-200">
                {candidatos.map(({ lote, fila }) => (
                  <li key={lote.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-marca-50"
                      onClick={() => {
                        fijar({ lote: lote.id, producto: null });
                        setBusqueda('');
                      }}
                    >
                      <span className="flex-1">
                        {fila.producto.nombre}
                        <span className="block font-mono text-xs text-stone-500">
                          {lote.codigo}
                        </span>
                      </span>
                      <span className="text-sm font-semibold">{stocks?.get(lote.id) ?? 0} u.</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <span className="etiqueta">Cantidad</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="boton-secundario w-14 text-2xl"
              onClick={() => setCantidad((c) => Math.max(1, c - 1))}
              aria-label="Restar"
            >
              −
            </button>
            <input
              className="campo text-center text-xl font-semibold"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={cantidad}
              onChange={(e) => setCantidad(Math.max(0, Math.floor(Number(e.target.value))))}
              aria-label="Cantidad"
            />
            <button
              type="button"
              className="boton-secundario w-14 text-2xl"
              onClick={() => setCantidad((c) => c + 1)}
              aria-label="Sumar"
            >
              +
            </button>
          </div>
        </div>
        <div>
          <label className="etiqueta" htmlFor="nota">
            Nota (opcional)
          </label>
          <input
            id="nota"
            className="campo"
            maxLength={500}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
        </div>
        {aviso && (
          <p
            className={aviso.ok ? 'text-emerald-700' : 'text-red-700'}
            role={aviso.ok ? 'status' : 'alert'}
          >
            {aviso.texto}
          </p>
        )}
        <button
          className={`w-full ${tipo === 'salida' ? 'boton-primario' : 'boton bg-emerald-600 text-white'}`}
          disabled={!loteId || cantidad < 1 || (tipo === 'salida' && cantidad > stockElegido)}
        >
          {tipo === 'salida' ? 'Registrar venta' : 'Registrar entrada'}
        </button>
      </form>

      <section className="tarjeta">
        <h2 className="mb-2 text-lg font-semibold">Recientes</h2>
        <ul className="divide-y divide-stone-100">
          {(recientes ?? []).map((m) => {
            const info = indiceLotes.get(m.lote_id);
            return (
              <li
                key={m.id}
                className={`flex items-center gap-3 py-2 ${m.eliminado ? 'opacity-50' : ''}`}
              >
                <span
                  className={`w-12 text-right font-semibold ${m.tipo === 'entrada' ? 'text-emerald-700' : 'text-marca-700'}`}
                >
                  {m.tipo === 'entrada' ? '+' : '−'}
                  {m.cantidad}
                </span>
                <div className={`min-w-0 flex-1 ${m.eliminado ? 'line-through' : ''}`}>
                  <div className="truncate">{info?.nombre ?? 'Producto'}</div>
                  <div className="truncate text-xs text-stone-500">
                    <span className="font-mono">{info?.codigo}</span> ·{' '}
                    {formatoFecha.format(new Date(m.ocurrido_en))}
                    {m.nota && ` · ${m.nota}`}
                  </div>
                </div>
                {!m.eliminado && (
                  <button
                    className="text-sm text-stone-500 underline"
                    onClick={async () => {
                      if (!confirm('¿Anular este movimiento?')) return;
                      try {
                        await anularMovimiento(m.id);
                        programarSync();
                      } catch (err) {
                        setAviso({ ok: false, texto: (err as Error).message });
                      }
                    }}
                  >
                    Anular
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
