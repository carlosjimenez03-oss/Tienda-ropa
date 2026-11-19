import { useDeferredValue, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/local';
import { anularMovimiento, registrarMovimiento } from '../dominio/operaciones';
import {
  cargarProductos,
  filtrar,
  formatoFecha,
  formatoPrecio,
  normalizar,
} from '../dominio/consultas';
import { stockPorLote } from '../../shared/stock';
import { programarSync } from '../sync/engine';
import { ImagenProducto } from '../componentes/ImagenProducto';
import { aNumero } from '../componentes/FormProducto';
import { notificarStockBajo } from '../notificaciones';
import { usePermisos } from '../auth/sesion';

const MAX_LISTA = 30;

/**
 * Pantalla "Vender": se toca un producto de la lista (o se busca), se elige la
 * cantidad con botones grandes y se confirma. También sirve para registrar
 * mercancía que llega (entrada).
 */
export function Movimientos() {
  const [params, setParams] = useSearchParams();
  const permisos = usePermisos();
  const tiposPermitidos = (['salida', 'entrada'] as const).filter((t) =>
    t === 'salida' ? permisos.puede_vender : permisos.puede_agregar_mercancia,
  );
  const pedido = params.get('tipo') === 'entrada' ? 'entrada' : 'salida';
  const tipo = tiposPermitidos.includes(pedido) ? pedido : (tiposPermitidos[0] ?? 'salida');
  const productos = useLiveQuery(cargarProductos, []);
  const stocks = useLiveQuery(async () => stockPorLote(await db.movimientos.toArray()), []);
  const recientes = useLiveQuery(
    () => db.movimientos.orderBy('ocurrido_en').reverse().limit(30).toArray(),
    [],
  );

  const [busqueda, setBusqueda] = useState('');
  const diferida = useDeferredValue(busqueda);
  const [cantidad, setCantidad] = useState(1);
  const [nota, setNota] = useState('');
  /** Texto del precio (venta) o costo (entrada) por unidad; vacío = el precio del producto */
  const [precio, setPrecio] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string; alerta?: string } | null>(null);

  // Lote elegido: por parámetro ?lote=, o el más reciente con stock de ?producto=
  const loteId = useMemo(() => {
    const directo = params.get('lote');
    if (directo) return directo;
    const pid = params.get('producto');
    const fila = productos?.find((f) => f.producto.id === pid);
    if (!fila) return null;
    return (fila.lotes.find((l) => (stocks?.get(l.id) ?? 0) > 0) ?? fila.lotes[0])?.id ?? null;
  }, [params, productos, stocks]);

  const filaElegida = useMemo(
    () => productos?.find((f) => f.lotes.some((l) => l.id === loteId)),
    [productos, loteId],
  );
  const loteElegido = filaElegida?.lotes.find((l) => l.id === loteId);
  const stockElegido = loteId ? (stocks?.get(loteId) ?? 0) : 0;

  const nombrePorLote = useMemo(() => {
    const m = new Map<string, { codigo: string; nombre: string }>();
    for (const f of productos ?? [])
      for (const l of f.lotes) m.set(l.id, { codigo: l.codigo, nombre: f.producto.nombre });
    return m;
  }, [productos]);

  // Lista para tocar: sin escribir nada se muestran los productos (primero los que tienen stock al vender)
  const lista = useMemo(() => {
    if (!productos) return [];
    const base = filtrar(productos, diferida);
    const ordenada =
      tipo === 'salida' && !diferida.trim()
        ? [...base].sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0))
        : base;
    return ordenada.slice(0, MAX_LISTA);
  }, [productos, diferida, tipo]);

  function fijar(cambios: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  }

  function elegirProducto(productoId: string) {
    // Si se buscó un código de lote concreto, se usa ese lote
    const q = normalizar(busqueda.trim());
    const fila = productos?.find((f) => f.producto.id === productoId);
    const porCodigo = q ? fila?.lotes.find((l) => normalizar(l.codigo) === q) : undefined;
    fijar(
      porCodigo ? { lote: porCodigo.id, producto: null } : { producto: productoId, lote: null },
    );
    setBusqueda('');
    setCantidad(1);
    setAviso(null);
  }

  async function registrar(e: FormEvent) {
    e.preventDefault();
    if (!loteId) return;
    setAviso(null);
    try {
      const r = await registrarMovimiento({
        loteId,
        tipo,
        cantidad,
        nota,
        precioUnitario: aNumero(precio, tipo === 'salida' ? 'Precio' : 'Costo'),
      });
      programarSync();
      let alerta: string | undefined;
      if (r.alertaStockBajo) {
        alerta =
          r.stockProducto <= 0
            ? `Se agotó ${r.producto.nombre}. Hay que reponer.`
            : `Quedan solo ${r.stockProducto} de ${r.producto.nombre}. Conviene reponer.`;
        notificarStockBajo(r.producto.nombre, r.stockProducto);
      }
      setAviso({
        ok: true,
        texto:
          tipo === 'salida'
            ? `Venta registrada: ${cantidad} × ${r.producto.nombre}`
            : `Mercancía agregada: ${cantidad} × ${r.producto.nombre} (ahora hay ${r.stockProducto})`,
        alerta,
      });
      setPrecio('');
      setCantidad(1);
      setNota('');
      fijar({ lote: null, producto: null });
    } catch (err) {
      setAviso({ ok: false, texto: (err as Error).message });
    }
  }

  let precioEfectivo: number | null = null;
  try {
    precioEfectivo = aNumero(precio, 'Precio') ?? filaElegida?.producto.precio ?? null;
  } catch {
    precioEfectivo = null;
  }
  const sinStock = tipo === 'salida' && stockElegido <= 0;
  const excede = tipo === 'salida' && cantidad > stockElegido;

  return (
    <div className="space-y-4">
      <div
        className={`grid gap-2 rounded-2xl bg-stone-100 p-1 ${tiposPermitidos.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}
        role="radiogroup"
        aria-label="¿Qué quieres hacer?"
      >
        {tiposPermitidos.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tipo === t}
            onClick={() => {
              fijar({ tipo: t });
              setAviso(null);
            }}
            className={`min-h-14 rounded-xl text-lg font-semibold ${
              tipo === t
                ? t === 'salida'
                  ? 'bg-marca-700 text-white shadow'
                  : 'bg-emerald-600 text-white shadow'
                : 'text-stone-600'
            }`}
          >
            {t === 'salida' ? '🛒 Vender' : '📦 Llegó mercancía'}
          </button>
        ))}
      </div>

      {aviso && (
        <div
          className={`rounded-2xl p-4 text-lg font-semibold ${
            aviso.ok ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
          }`}
          role={aviso.ok ? 'status' : 'alert'}
        >
          {aviso.ok ? '✅ ' : '⚠️ '}
          {aviso.texto}
        </div>
      )}
      {aviso?.alerta && (
        <div
          className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="alert"
          data-testid="alerta-stock"
        >
          <span aria-hidden>⚠️ </span>
          <strong>{aviso.alerta}</strong>
        </div>
      )}

      {filaElegida && loteElegido ? (
        <form onSubmit={registrar} className="tarjeta space-y-5">
          <div className="flex items-center gap-3">
            <ImagenProducto
              id={filaElegida.imagenId}
              className="h-20 w-20 shrink-0 rounded-xl"
              alt={filaElegida.producto.nombre}
            />
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold">{filaElegida.producto.nombre}</div>
              <div className="text-stone-600">
                {[filaElegida.producto.talla, filaElegida.producto.color]
                  .filter(Boolean)
                  .join(' · ')}
                {filaElegida.producto.precio != null &&
                  ` · ${formatoPrecio.format(filaElegida.producto.precio)}`}
              </div>
              <div className={stockElegido > 0 ? 'text-emerald-700' : 'text-red-700'}>
                Quedan <strong>{stockElegido}</strong>
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-xl border border-stone-300 px-3 py-2 text-sm"
              onClick={() => fijar({ lote: null, producto: null })}
            >
              Cambiar
            </button>
          </div>

          {filaElegida.lotes.length > 1 && (
            <div>
              <label className="etiqueta" htmlFor="lote">
                Lote
              </label>
              <select
                id="lote"
                className="campo font-mono"
                value={loteElegido.id}
                onChange={(e) => fijar({ lote: e.target.value, producto: null })}
              >
                {filaElegida.lotes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.codigo} — quedan {stocks?.get(l.id) ?? 0}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <span className="etiqueta text-base">¿Cuántas unidades?</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="boton-secundario h-16 w-16 text-3xl"
                onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                aria-label="Una menos"
              >
                −
              </button>
              <input
                className="campo h-16 text-center text-3xl font-bold"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={cantidad || ''}
                onChange={(e) => setCantidad(Math.max(0, Math.floor(Number(e.target.value))))}
                aria-label="Cantidad"
              />
              <button
                type="button"
                className="boton-secundario h-16 w-16 text-3xl"
                onClick={() => setCantidad((c) => c + 1)}
                aria-label="Una más"
              >
                +
              </button>
            </div>
            {tipo === 'salida' && precioEfectivo != null && cantidad > 0 && (
              <p className="mt-2 text-center text-lg">
                Total: <strong>{formatoPrecio.format(precioEfectivo * cantidad)}</strong>
              </p>
            )}
            {sinStock && <p className="mt-2 text-red-700">No quedan unidades de este producto.</p>}
            {!sinStock && excede && (
              <p className="mt-2 text-red-700">Solo quedan {stockElegido}.</p>
            )}
          </div>

          <div>
            <label className="etiqueta" htmlFor="precio-unidad">
              {tipo === 'salida' ? 'Precio por unidad (RD$)' : '¿Cuánto costó cada una? (opcional)'}
            </label>
            <input
              id="precio-unidad"
              className="campo"
              inputMode="decimal"
              placeholder={
                tipo === 'salida' && filaElegida.producto.precio != null
                  ? `${filaElegida.producto.precio} (cámbialo si hiciste descuento)`
                  : 'Ej.: 600'
              }
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
            />
          </div>

          <details>
            <summary className="cursor-pointer text-stone-600">Añadir una nota (opcional)</summary>
            <input
              className="campo mt-2"
              maxLength={500}
              placeholder={
                tipo === 'salida' ? 'Ej.: pagó con tarjeta' : 'Ej.: pedido del proveedor'
              }
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              aria-label="Nota"
            />
          </details>

          <button
            className={`boton min-h-16 w-full text-xl text-white ${
              tipo === 'salida'
                ? 'bg-marca-700 hover:bg-marca-800'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
            disabled={cantidad < 1 || excede}
          >
            {tipo === 'salida' ? 'Registrar venta' : 'Agregar al inventario'}
          </button>
        </form>
      ) : (
        <section className="space-y-3">
          <h1 className="text-xl font-bold">
            {tipo === 'salida' ? '¿Qué producto vendiste?' : '¿Qué producto llegó?'}
          </h1>
          <input
            className="campo"
            type="search"
            placeholder="Buscar por nombre, talla, color o código…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            autoComplete="off"
            aria-label="Buscar producto"
          />
          {productos && productos.length === 0 ? (
            <div className="tarjeta text-center text-stone-600">
              Todavía no hay productos.{' '}
              <Link to="/nuevo" className="font-semibold text-marca-700 underline">
                Agrega el primero
              </Link>
              .
            </div>
          ) : lista.length === 0 ? (
            <p className="text-stone-500">No se encontró ningún producto.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {lista.map((f) => (
                <li key={f.producto.id}>
                  <button
                    type="button"
                    onClick={() => elegirProducto(f.producto.id)}
                    className="tarjeta flex w-full items-center gap-3 p-3 text-left hover:border-marca-200 active:bg-marca-50"
                  >
                    <ImagenProducto
                      id={f.imagenId}
                      className="h-14 w-14 shrink-0 rounded-lg"
                      alt=""
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{f.producto.nombre}</span>
                      <span className="block truncate text-sm text-stone-500">
                        {[f.producto.talla, f.producto.color].filter(Boolean).join(' · ')}
                        {f.producto.precio != null &&
                          ` · ${formatoPrecio.format(f.producto.precio)}`}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-sm font-semibold ${
                        f.stock > 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-stone-100 text-stone-500'
                      }`}
                    >
                      {f.stock}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <details className="tarjeta">
        <summary className="cursor-pointer text-lg font-semibold">
          Últimas ventas y entradas
        </summary>
        <ul className="mt-2 divide-y divide-stone-100">
          {(recientes ?? []).map((m) => {
            const info = nombrePorLote.get(m.lote_id);
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
                  <div className="truncate">
                    {m.tipo === 'entrada' ? 'Entrada' : 'Venta'} · {info?.nombre ?? 'Producto'}
                  </div>
                  <div className="truncate text-xs text-stone-500">
                    {formatoFecha.format(new Date(m.ocurrido_en))}
                    {m.nota && ` · ${m.nota}`}
                  </div>
                </div>
                {m.eliminado ? (
                  <span className="text-xs text-stone-500">Anulada</span>
                ) : !(m.tipo === 'salida'
                    ? permisos.puede_vender
                    : permisos.puede_agregar_mercancia ||
                      permisos.puede_editar_productos) ? null : (
                  <button
                    className="rounded-lg border border-stone-300 px-2 py-1 text-sm text-stone-600"
                    onClick={async () => {
                      const texto =
                        m.tipo === 'salida'
                          ? '¿Deshacer esta venta? Las unidades vuelven al inventario.'
                          : '¿Deshacer esta entrada? Las unidades se restan del inventario.';
                      if (!confirm(texto)) return;
                      try {
                        await anularMovimiento(m.id);
                        programarSync();
                      } catch (err) {
                        setAviso({ ok: false, texto: (err as Error).message });
                      }
                    }}
                  >
                    Deshacer
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
