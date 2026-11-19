import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { crearProducto } from '../dominio/operaciones';
import { programarSync } from '../sync/engine';
import { CampoImagen } from '../componentes/CampoImagen';
import { aDatos, CamposProducto, formVacio } from '../componentes/FormProducto';

export function NuevoProducto() {
  const navegar = useNavigate();
  const [v, setV] = useState(formVacio);
  const [cantidad, setCantidad] = useState('1');
  const [imagen, setImagen] = useState<Blob | null>(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      const { producto } = await crearProducto({
        ...aDatos(v),
        cantidadInicial: Number(cantidad || 0),
        imagen,
      });
      programarSync();
      navegar(`/producto/${producto.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Nuevo producto</h1>
      <div className="tarjeta space-y-4">
        <CamposProducto v={v} set={setV} />
        <div>
          <label className="etiqueta" htmlFor="cantidad">
            Cantidad inicial
          </label>
          <input
            id="cantidad"
            className="campo"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
          />
          <p className="mt-1 text-xs text-stone-500">
            Se crea un lote automáticamente con esta cantidad.
          </p>
        </div>
        <CampoImagen onCambio={setImagen} />
      </div>
      {error && (
        <p className="text-red-700" role="alert">
          {error}
        </p>
      )}
      <button className="boton-primario w-full" disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar producto'}
      </button>
    </form>
  );
}
