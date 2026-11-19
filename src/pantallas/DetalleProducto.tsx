import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/local';
import {
  actualizarProducto,
  agregarImagen,
  crearLote,
  eliminarProducto,
} from '../dominio/operaciones';
import { formatoFecha, formatoPrecio } from '../dominio/consultas';
import { stockPorLote } from '../../shared/stock';
import { programarSync } from '../sync/engine';
import { ImagenProducto } from '../componentes/ImagenProducto';
import { usePermisos } from '../auth/sesion';
import { CampoImagen } from '../componentes/CampoImagen';
import { aDatos, CamposProducto, type ValoresForm } from '../componentes/FormProducto';

export function DetalleProducto() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const permisos = usePermisos();
  const puedeEntrada = permisos.puede_agregar_mercancia || permisos.puede_editar_productos;
  const recienCreado = (useLocation().state as { creado?: boolean } | null)?.creado === true;
  const datos = useLiveQuery(async () => {
    const producto = await db.productos.get(id);
    if (!producto) return null;
    const lotes = (await db.lotes.where('producto_id').equals(id).toArray()).sort((a, b) =>
      b.creado_en.localeCompare(a.creado_en),
    );
    const movimientos = await db.movimientos
      .where('lote_id')
      .anyOf(lotes.map((l) => l.id))
      .toArray();
    const imagenes = (await db.imagenes.where('producto_id').equals(id).toArray()).filter(
      (i) => !i.eliminado,
    );
    return { producto, lotes, movimientos, imagenes, stock: stockPorLote(movimientos) };
  }, [id]);
  const [editando, setEditando] = useState<ValoresForm | null>(null);
  const [cantidadLote, setCantidadLote] = useState('');
  const [nuevaImagen, setNuevaImagen] = useState<Blob | null>(null);
  const [error, setError] = useState('');

  if (datos === undefined) return <p className="text-stone-500">Cargando…</p>;
  if (datos === null || datos.producto.eliminado) {
    return (
      <div className="tarjeta">
        Producto no encontrado.{' '}
        <Link to="/productos" className="text-marca-700 underline">
          Volver
        </Link>
      </div>
    );
  }
  const { producto, lotes, movimientos, imagenes, stock } = datos;
  const total = lotes.reduce((s, l) => s + (stock.get(l.id) ?? 0), 0);
  const codigoPorLote = new Map(lotes.map((l) => [l.id, l.codigo]));

  async function ejecutar(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      programarSync();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function guardarEdicion(e: FormEvent) {
    e.preventDefault();
    await ejecutar(async () => {
      await actualizarProducto(producto.id, aDatos(editando!));
      setEditando(null);
    });
  }

  return (
    <div className="space-y-4">
      <Link to="/productos" className="text-sm text-marca-700">
        ← Productos
      </Link>
      {recienCreado && (
        <div
          className="rounded-2xl bg-emerald-100 p-4 text-lg font-semibold text-emerald-900"
          role="status"
        >
          ✅ Producto guardado
        </div>
      )}
      <div className="tarjeta flex flex-col gap-4 sm:flex-row">
        <ImagenProducto
          id={imagenes[0]?.id}
          className="h-48 w-full rounded-xl sm:h-40 sm:w-40"
          alt={producto.nombre}
        />
        <div className="flex-1">
          {editando ? (
            <form onSubmit={guardarEdicion} className="space-y-3">
              <CamposProducto v={editando} set={setEditando} />
              <div className="flex gap-2">
                <button className="boton-primario">Guardar</button>
                <button
                  type="button"
                  className="boton-secundario"
                  onClick={() => setEditando(null)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <>
              <h1 className="text-2xl font-bold">{producto.nombre}</h1>
              <p className="text-stone-600">
                {[
                  producto.talla && `Talla ${producto.talla}`,
                  producto.color,
                  producto.sku && `Ref. ${producto.sku}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Sin detalles'}
              </p>
              {producto.precio != null && (
                <p className="mt-1 text-xl font-semibold">
                  {formatoPrecio.format(producto.precio)}
                </p>
              )}
              <p className="mt-2 text-lg">
                <strong>{total}</strong> en stock
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {permisos.puede_vender && (
                  <Link
                    to={`/movimientos?producto=${producto.id}&tipo=salida`}
                    className="boton-primario"
                  >
                    Registrar venta
                  </Link>
                )}
                {permisos.puede_editar_productos && (
                  <button
                    className="boton-secundario"
                    onClick={() =>
                      setEditando({
                        nombre: producto.nombre,
                        sku: producto.sku ?? '',
                        talla: producto.talla ?? '',
                        color: producto.color ?? '',
                        precio: producto.precio?.toString() ?? '',
                        stock_minimo: String(producto.stock_minimo ?? 2),
                      })
                    }
                  >
                    Editar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="text-red-700" role="alert">
          {error}
        </p>
      )}

      <section className="tarjeta">
        <h2 className="mb-3 text-lg font-semibold">Lotes</h2>
        <ul className="divide-y divide-stone-100">
          {lotes.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-mono font-semibold" data-testid="codigo-lote">
                {l.codigo}
              </span>
              <span className="text-sm text-stone-500">
                {formatoFecha.format(new Date(l.creado_en))}
              </span>
              <span className="ml-auto font-semibold">{stock.get(l.id) ?? 0} u.</span>
              {permisos.puede_agregar_mercancia && (
                <Link
                  to={`/movimientos?lote=${l.id}&tipo=entrada`}
                  className="rounded-lg border px-3 py-1 text-sm"
                >
                  Entrada
                </Link>
              )}
              {permisos.puede_vender && (
                <Link
                  to={`/movimientos?lote=${l.id}&tipo=salida`}
                  className="rounded-lg bg-marca-700 px-3 py-1 text-sm text-white"
                >
                  Venta
                </Link>
              )}
            </li>
          ))}
        </ul>
        {puedeEntrada && (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ejecutar(async () => {
                await crearLote(producto.id, Number(cantidadLote || 0));
                setCantidadLote('');
              });
            }}
          >
            <input
              className="campo"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              placeholder="Cantidad del nuevo lote"
              value={cantidadLote}
              onChange={(e) => setCantidadLote(e.target.value)}
              aria-label="Cantidad del nuevo lote"
            />
            <button className="boton-secundario shrink-0">+ Nuevo lote</button>
          </form>
        )}
      </section>

      <section className="tarjeta space-y-3">
        <h2 className="text-lg font-semibold">Fotos</h2>
        {imagenes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {imagenes.map((i) => (
              <ImagenProducto key={i.id} id={i.id} className="h-24 w-24 rounded-xl" />
            ))}
          </div>
        )}
        {permisos.puede_editar_productos && <CampoImagen onCambio={setNuevaImagen} />}
        {nuevaImagen && (
          <button
            className="boton-secundario"
            onClick={() =>
              ejecutar(async () => {
                await agregarImagen(producto.id, nuevaImagen);
                setNuevaImagen(null);
              })
            }
          >
            Añadir foto
          </button>
        )}
      </section>

      <section className="tarjeta">
        <h2 className="mb-3 text-lg font-semibold">Últimos movimientos</h2>
        {movimientos.length === 0 ? (
          <p className="text-stone-500">Sin movimientos.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {movimientos
              .sort((a, b) => b.ocurrido_en.localeCompare(a.ocurrido_en))
              .slice(0, 20)
              .map((m) => (
                <li
                  key={m.id}
                  className={`flex gap-2 py-2 ${m.eliminado ? 'text-stone-400 line-through' : ''}`}
                >
                  <span className={m.tipo === 'entrada' ? 'text-emerald-700' : 'text-marca-700'}>
                    {m.tipo === 'entrada' ? '+' : '−'}
                    {m.cantidad}
                  </span>
                  <span className="font-mono text-xs leading-5 text-stone-500">
                    {codigoPorLote.get(m.lote_id)}
                  </span>
                  <span className="flex-1 truncate">{m.nota}</span>
                  <span className="text-stone-500">
                    {formatoFecha.format(new Date(m.ocurrido_en))}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>

      {permisos.puede_editar_productos && (
        <button
          className="text-sm text-red-700 underline"
          onClick={() => {
            if (confirm(`¿Eliminar "${producto.nombre}"? Los movimientos se conservan.`)) {
              ejecutar(async () => {
                await eliminarProducto(producto.id);
                navegar('/productos', { replace: true });
              });
            }
          }}
        >
          Eliminar producto
        </button>
      )}
    </div>
  );
}
