import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { cargarProductos, filtrar, formatoPrecio } from '../dominio/consultas';
import { ImagenProducto } from '../componentes/ImagenProducto';
import { usePermisos } from '../auth/sesion';

const PAGINA = 60;

export function Productos() {
  const permisos = usePermisos();
  const filas = useLiveQuery(cargarProductos, []);
  const [consulta, setConsulta] = useState('');
  const diferida = useDeferredValue(consulta);
  const [limite, setLimite] = useState(PAGINA);
  const [params, setParams] = useSearchParams();
  const soloReponer = params.get('filtro') === 'reponer';
  const resultado = useMemo(() => {
    if (!filas) return [];
    const base = filtrar(filas, diferida);
    return soloReponer ? base.filter((f) => f.estado !== 'ok') : base;
  }, [filas, diferida, soloReponer]);
  const cuantosReponer = filas?.filter((f) => f.estado !== 'ok').length ?? 0;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Productos</h1>
        {permisos.puede_editar_productos && (
          <Link to="/nuevo" className="boton-primario hidden md:inline-flex">
            + Nuevo producto
          </Link>
        )}
      </div>
      <input
        type="search"
        className="campo mb-4"
        placeholder="Buscar por nombre, talla, color o código de lote…"
        value={consulta}
        onChange={(e) => {
          setConsulta(e.target.value);
          setLimite(PAGINA);
        }}
        aria-label="Buscar productos"
      />
      {cuantosReponer > 0 && (
        <div className="mb-4 flex gap-2">
          <button
            className={`rounded-full border px-4 py-2 text-sm font-medium ${
              soloReponer ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-300 bg-white'
            }`}
            onClick={() => setParams(soloReponer ? {} : { filtro: 'reponer' }, { replace: true })}
            aria-pressed={soloReponer}
          >
            ⚠️ Por reponer ({cuantosReponer})
          </button>
        </div>
      )}
      {!filas ? (
        <p className="text-stone-500">Cargando…</p>
      ) : resultado.length === 0 ? (
        <div className="tarjeta text-center text-stone-500">
          {filas.length === 0 ? (
            <div className="space-y-3 text-left text-stone-700">
              <p className="text-center text-lg font-semibold">¡Hola! Empecemos en 3 pasos:</p>
              <ol className="mx-auto max-w-sm list-decimal space-y-1 pl-6">
                <li>
                  Toca <strong>Nuevo</strong> y agrega un producto con su foto.
                </li>
                <li>
                  Cuando vendas algo, toca <strong>Vender</strong>.
                </li>
                <li>Funciona aunque no haya internet: los cambios se envían solos al volver.</li>
              </ol>
              <div className="text-center">
                <Link to="/nuevo" className="boton-primario">
                  + Agregar el primer producto
                </Link>
              </div>
            </div>
          ) : (
            'No se encontró ningún producto con esa búsqueda.'
          )}
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-stone-500">
            {resultado.length} {resultado.length === 1 ? 'producto' : 'productos'}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {resultado.slice(0, limite).map((f) => (
              <li key={f.producto.id} className="tarjeta flex gap-3 p-3">
                <Link to={`/producto/${f.producto.id}`} className="shrink-0">
                  <ImagenProducto
                    id={f.imagenId}
                    className="h-20 w-20 rounded-xl"
                    alt={f.producto.nombre}
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/producto/${f.producto.id}`}
                    className="block truncate font-semibold hover:underline"
                  >
                    {f.producto.nombre}
                  </Link>
                  <p className="truncate text-sm text-stone-500">
                    {[f.producto.talla, f.producto.color].filter(Boolean).join(' · ') || '—'}
                    {f.producto.precio != null && ` · ${formatoPrecio.format(f.producto.precio)}`}
                  </p>
                  <p className="truncate font-mono text-xs text-stone-400">{f.lotes[0]?.codigo}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-sm font-semibold ${
                        f.stock > 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-stone-100 text-stone-500'
                      }`}
                    >
                      {f.stock} en stock
                    </span>
                    {f.estado === 'agotado' && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-sm font-semibold text-red-800">
                        🚫 Agotado
                      </span>
                    )}
                    {f.estado === 'por_acabarse' && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-sm font-semibold text-amber-900">
                        ⚠️ Quedan pocos
                      </span>
                    )}
                    {permisos.puede_vender && f.stock > 0 && f.lotes[0] && (
                      <Link
                        to={`/movimientos?producto=${f.producto.id}&tipo=salida`}
                        className="ml-auto rounded-lg bg-marca-700 px-3 py-1.5 text-sm font-semibold text-white"
                      >
                        Vender
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {resultado.length > limite && (
            <button
              className="boton-secundario mt-4 w-full"
              onClick={() => setLimite((l) => l + PAGINA)}
            >
              Mostrar más
            </button>
          )}
        </>
      )}
    </div>
  );
}
