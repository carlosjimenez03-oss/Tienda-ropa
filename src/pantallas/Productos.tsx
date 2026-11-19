import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { cargarProductos, filtrar, formatoPrecio } from '../dominio/consultas';
import { ImagenProducto } from '../componentes/ImagenProducto';

const PAGINA = 60;

export function Productos() {
  const filas = useLiveQuery(cargarProductos, []);
  const [consulta, setConsulta] = useState('');
  const diferida = useDeferredValue(consulta);
  const [limite, setLimite] = useState(PAGINA);
  const resultado = useMemo(() => (filas ? filtrar(filas, diferida) : []), [filas, diferida]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Productos</h1>
        <Link to="/nuevo" className="boton-primario hidden md:inline-flex">
          + Nuevo producto
        </Link>
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
      {!filas ? (
        <p className="text-stone-500">Cargando…</p>
      ) : resultado.length === 0 ? (
        <div className="tarjeta text-center text-stone-500">
          {filas.length === 0 ? (
            <>
              Aún no hay productos.{' '}
              <Link to="/nuevo" className="font-semibold text-marca-700 underline">
                Crea el primero
              </Link>
              .
            </>
          ) : (
            'No hay resultados para esa búsqueda.'
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
                    {f.stock > 0 && f.lotes[0] && (
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
