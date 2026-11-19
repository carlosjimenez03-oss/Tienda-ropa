import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/local';
import {
  cargarProductos,
  formatoFecha,
  formatoPrecio,
  type FilaProducto,
} from '../dominio/consultas';
import { calcularResumen, NOMBRES_PERIODO, type DiaVentas, type Periodo } from '../dominio/resumen';
import { ImagenProducto } from '../componentes/ImagenProducto';
import { usePermisos } from '../auth/sesion';

const formatoDiaCorto = new Intl.DateTimeFormat('es-DO', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const formatoDiaLargo = new Intl.DateTimeFormat('es-DO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const formatoEntero = new Intl.NumberFormat('es-DO');

function nombreDia(dia: string, largo = false) {
  return (largo ? formatoDiaLargo : formatoDiaCorto).format(new Date(`${dia}T12:00:00Z`));
}

function leerPeriodo(): Periodo {
  try {
    const v = localStorage.getItem('periodo-panel');
    if (v === 'hoy' || v === '7d' || v === 'mes' || v === '30d') return v;
  } catch {
    /* ignorar */
  }
  return '7d';
}

export function Inicio() {
  const permisos = usePermisos();
  const [periodo, setPeriodoEstado] = useState<Periodo>(leerPeriodo);
  const setPeriodo = (p: Periodo) => {
    setPeriodoEstado(p);
    try {
      localStorage.setItem('periodo-panel', p);
    } catch {
      /* ignorar */
    }
  };

  const datos = useLiveQuery(async () => {
    const [productos, lotes, movimientos, filas] = await Promise.all([
      db.productos.toArray(),
      db.lotes.toArray(),
      db.movimientos.toArray(),
      cargarProductos(),
    ]);
    return { productos, lotes, movimientos, filas };
  }, []);

  const resumen = useMemo(() => (datos ? calcularResumen(datos, periodo) : null), [datos, periodo]);

  if (!datos || !resumen) return <p className="text-stone-500">Cargando…</p>;

  const { filas } = datos;
  const agotados = filas.filter((f) => f.estado === 'agotado');
  const porAcabarse = filas.filter((f) => f.estado === 'por_acabarse');
  const unidadesInventario = filas.reduce((s, f) => s + Math.max(f.stock, 0), 0);
  const valorInventario = filas.reduce(
    (s, f) => s + Math.max(f.stock, 0) * (f.producto.precio ?? 0),
    0,
  );
  const ultimos = [...datos.movimientos]
    .sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en))
    .slice(0, 5);
  const nombrePorLote = new Map(
    filas.flatMap((f) => f.lotes.map((l) => [l.id, f.producto.nombre] as const)),
  );

  if (filas.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Resumen</h1>
        <div className="tarjeta space-y-3 text-stone-700">
          <p className="text-center text-lg font-semibold">¡Hola! Empecemos en 3 pasos:</p>
          <ol className="mx-auto max-w-sm list-decimal space-y-1 pl-6">
            <li>
              Toca <strong>Nuevo</strong> y agrega un producto con su foto.
            </li>
            <li>
              Cuando vendas algo, toca <strong>Vender</strong>.
            </li>
            <li>Aquí verás lo vendido, lo comprado y lo que se está acabando.</li>
          </ol>
          <div className="text-center">
            <Link to="/nuevo" className="boton-primario">
              + Agregar el primer producto
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!permisos.puede_ver_resumen) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Inicio</h1>
        <AlertasStock
          agotados={agotados}
          porAcabarse={porAcabarse}
          puedeReponer={permisos.puede_agregar_mercancia}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {permisos.puede_vender && (
            <Link to="/movimientos?tipo=salida" className="boton-primario min-h-20 text-xl">
              🛒 Vender
            </Link>
          )}
          <Link to="/productos" className="boton-secundario min-h-20 text-xl">
            👗 Ver productos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Resumen</h1>
        <div
          className="flex rounded-xl bg-stone-100 p-1 text-sm"
          role="radiogroup"
          aria-label="Periodo"
        >
          {(Object.keys(NOMBRES_PERIODO) as Periodo[]).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={periodo === p}
              onClick={() => setPeriodo(p)}
              className={`min-h-10 rounded-lg px-3 font-medium ${
                periodo === p ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
              }`}
            >
              {NOMBRES_PERIODO[p]}
            </button>
          ))}
        </div>
      </div>

      <AlertasStock
        agotados={agotados}
        porAcabarse={porAcabarse}
        puedeReponer={permisos.puede_agregar_mercancia}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Cifra
          titulo="Vendido"
          valor={formatoPrecio.format(resumen.vendido.monto)}
          detalle={`${formatoEntero.format(resumen.vendido.unidades)} unidades en ${resumen.vendido.ventas} ${
            resumen.vendido.ventas === 1 ? 'venta' : 'ventas'
          }`}
          testId="cifra-vendido"
        />
        <Cifra
          titulo="Comprado (mercancía que llegó)"
          valor={formatoPrecio.format(resumen.comprado.monto)}
          detalle={`${formatoEntero.format(resumen.comprado.unidades)} unidades${
            resumen.comprado.sinCosto > 0
              ? ` · ${resumen.comprado.sinCosto} ${resumen.comprado.sinCosto === 1 ? 'entrada' : 'entradas'} sin costo anotado`
              : ''
          }`}
          testId="cifra-comprado"
        />
        <Cifra
          titulo="En inventario ahora"
          valor={`${formatoEntero.format(unidadesInventario)} unidades`}
          detalle={`Valen ${formatoPrecio.format(valorInventario)} a precio de venta`}
          testId="cifra-inventario"
        />
      </div>

      {periodo !== 'hoy' && <GraficoVentas dias={resumen.porDia} />}

      <section className="tarjeta">
        <h2 className="mb-2 text-lg font-semibold">Lo más vendido · {NOMBRES_PERIODO[periodo]}</h2>
        {resumen.masVendidos.length === 0 ? (
          <p className="text-stone-500">Todavía no hay ventas en este periodo.</p>
        ) : (
          <table className="w-full text-left">
            <thead className="text-sm text-stone-500">
              <tr>
                <th className="py-1 font-medium">Producto</th>
                <th className="py-1 pl-3 text-right font-medium">Unidades</th>
                <th className="py-1 pl-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {resumen.masVendidos.map((t) => (
                <tr key={t.producto.id}>
                  <td className="py-2">
                    <Link to={`/producto/${t.producto.id}`} className="hover:underline">
                      {t.producto.nombre}
                    </Link>
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap tabular-nums">
                    {t.unidades}
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap tabular-nums">
                    {formatoPrecio.format(t.monto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="tarjeta">
        <div className="mb-2 flex items-center">
          <h2 className="flex-1 text-lg font-semibold">Últimos movimientos</h2>
          <Link to="/movimientos" className="text-sm text-marca-700 underline">
            Ver todos
          </Link>
        </div>
        <ul className="divide-y divide-stone-100">
          {ultimos.map((m) => (
            <li
              key={m.id}
              className={`flex items-center gap-3 py-2 ${m.eliminado ? 'opacity-50' : ''}`}
            >
              <span
                className={`w-24 shrink-0 text-sm font-semibold ${
                  m.tipo === 'salida' ? 'text-marca-700' : 'text-emerald-700'
                }`}
              >
                {m.tipo === 'salida' ? `Venta −${m.cantidad}` : `Entrada +${m.cantidad}`}
              </span>
              <span className={`min-w-0 flex-1 truncate ${m.eliminado ? 'line-through' : ''}`}>
                {nombrePorLote.get(m.lote_id) ?? 'Producto'}
              </span>
              <span className="shrink-0 text-xs text-stone-500">
                {formatoFecha.format(new Date(m.ocurrido_en))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Cifra({
  titulo,
  valor,
  detalle,
  testId,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  testId: string;
}) {
  return (
    <div className="tarjeta" data-testid={testId}>
      <div className="text-sm font-medium text-stone-600">{titulo}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-stone-900">{valor}</div>
      <div className="mt-1 text-sm text-stone-500">{detalle}</div>
    </div>
  );
}

function AlertasStock({
  agotados,
  porAcabarse,
  puedeReponer,
}: {
  agotados: FilaProducto[];
  porAcabarse: FilaProducto[];
  puedeReponer: boolean;
}) {
  if (agotados.length === 0 && porAcabarse.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
        <span aria-hidden>✅</span> Ningún producto se está acabando.
      </div>
    );
  }
  const lista = [...agotados, ...porAcabarse];
  return (
    <section
      className="rounded-2xl border border-amber-300 bg-amber-50 p-4"
      aria-labelledby="titulo-alertas"
      data-testid="alertas-stock"
    >
      <h2 id="titulo-alertas" className="text-lg font-semibold text-amber-950">
        <span aria-hidden>⚠️ </span>
        {lista.length === 1
          ? '1 producto necesita reponerse'
          : `${lista.length} productos necesitan reponerse`}
      </h2>
      <ul className="mt-2 divide-y divide-amber-200">
        {lista.slice(0, 8).map((f) => (
          <li key={f.producto.id} className="flex items-center gap-3 py-2">
            <ImagenProducto id={f.imagenId} className="h-10 w-10 shrink-0 rounded-lg" alt="" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-stone-900">{f.producto.nombre}</div>
              <div className="text-sm text-stone-700">
                {f.estado === 'agotado' ? (
                  <strong className="text-red-800">🚫 Agotado</strong>
                ) : (
                  <>
                    Quedan <strong>{f.stock}</strong> (aviso en {f.minimo})
                  </>
                )}
              </div>
            </div>
            {puedeReponer && (
              <Link
                to={`/movimientos?producto=${f.producto.id}&tipo=entrada`}
                className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Reponer
              </Link>
            )}
          </li>
        ))}
      </ul>
      {lista.length > 8 && (
        <Link
          to="/productos?filtro=reponer"
          className="mt-2 inline-block text-sm text-amber-950 underline"
        >
          Ver los {lista.length}
        </Link>
      )}
    </section>
  );
}

/** Ventas por día (RD$): una sola serie, barras finas, detalle al tocar o pasar el ratón. */
function GraficoVentas({ dias }: { dias: DiaVentas[] }) {
  const [activo, setActivo] = useState<number | null>(null);
  const maximo = Math.max(...dias.map((d) => d.monto), 0);
  const total = dias.reduce((s, d) => s + d.monto, 0);
  const elegido = activo !== null ? dias[activo] : null;
  const etiquetaCada = dias.length > 14 ? 7 : dias.length > 7 ? 2 : 1;

  return (
    <section className="tarjeta">
      <h2 className="text-lg font-semibold">Ventas por día</h2>
      <p className="min-h-6 text-sm text-stone-600" aria-live="polite">
        {elegido ? (
          <>
            <span className="capitalize">{nombreDia(elegido.dia, true)}</span>:{' '}
            <strong className="text-stone-900">{formatoPrecio.format(elegido.monto)}</strong> ·{' '}
            {elegido.unidades} unidades
          </>
        ) : total === 0 ? (
          'Sin ventas en este periodo.'
        ) : (
          'Toca una barra para ver el detalle del día.'
        )}
      </p>
      <div className="relative mt-2 h-44" onMouseLeave={() => setActivo(null)}>
        {/* Línea de referencia del máximo, recesiva */}
        {maximo > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-stone-200">
            <span className="absolute right-0 -top-5 text-xs text-stone-400">
              {formatoPrecio.format(maximo)}
            </span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 border-t border-stone-300" />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {dias.map((d, i) => {
            const alto = maximo > 0 ? (d.monto / maximo) * 100 : 0;
            return (
              <button
                key={d.dia}
                type="button"
                className="group flex h-full flex-1 items-end justify-center"
                onMouseEnter={() => setActivo(i)}
                onFocus={() => setActivo(i)}
                onClick={() => setActivo(i)}
                aria-label={`${nombreDia(d.dia, true)}: ${formatoPrecio.format(d.monto)}, ${d.unidades} unidades`}
              >
                <span
                  className={`block w-full max-w-6 rounded-t ${
                    activo === i ? 'bg-marca-800' : 'bg-marca-600 group-hover:bg-marca-700'
                  }`}
                  style={{ height: d.monto > 0 ? `max(${alto}%, 3px)` : 0 }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex gap-[2px] text-[11px] text-stone-500">
        {dias.map((d, i) => (
          <span key={d.dia} className="flex-1 overflow-visible whitespace-nowrap text-center">
            {i % etiquetaCada === 0 || i === dias.length - 1
              ? nombreDia(d.dia).replace('.', '')
              : ''}
          </span>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-stone-600">Ver como tabla</summary>
        <table className="mt-2 w-full">
          <thead className="text-stone-500">
            <tr>
              <th className="text-left font-medium">Día</th>
              <th className="text-right font-medium">Unidades</th>
              <th className="text-right font-medium">Vendido</th>
            </tr>
          </thead>
          <tbody>
            {[...dias].reverse().map((d) => (
              <tr key={d.dia} className="border-t border-stone-100">
                <td className="py-1 capitalize">{nombreDia(d.dia, true)}</td>
                <td className="py-1 text-right tabular-nums">{d.unidades}</td>
                <td className="py-1 text-right tabular-nums">{formatoPrecio.format(d.monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
