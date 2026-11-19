import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { crearProducto } from '../dominio/operaciones';
import { programarSync } from '../sync/engine';
import { CampoImagen } from '../componentes/CampoImagen';
import { aDatos, aNumero, CamposProducto, formVacio } from '../componentes/FormProducto';

export function NuevoProducto() {
  const navegar = useNavigate();
  const [v, setV] = useState(formVacio);
  const [cantidad, setCantidad] = useState('1');
  const [costo, setCosto] = useState('');
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
        costoUnitario: aNumero(costo, 'Costo'),
        imagen,
      });
      programarSync();
      navegar(`/producto/${producto.id}`, { replace: true, state: { creado: true } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Agregar un producto</h1>
      <p className="text-stone-600">
        Solo el nombre es obligatorio. Lo demás puedes completarlo después.
      </p>
      <div className="tarjeta space-y-4">
        <CamposProducto v={v} set={setV} />
        <div>
          <label className="etiqueta text-base" htmlFor="cantidad">
            ¿Cuántas unidades tienes?
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
            Se le asigna un código de lote automáticamente; no tienes que hacer nada.
          </p>
        </div>
        <div>
          <label className="etiqueta" htmlFor="costo">
            ¿Cuánto te costó cada una? (opcional)
          </label>
          <input
            id="costo"
            className="campo"
            inputMode="decimal"
            placeholder="Ej.: 600"
            value={costo}
            onChange={(e) => setCosto(e.target.value)}
          />
          <p className="mt-1 text-xs text-stone-500">
            Sirve para ver en el Resumen cuánto has comprado.
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
