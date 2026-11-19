import { useEffect, useState } from 'react';
import { comprimirImagen } from '../imagenes/comprimir';

export function CampoImagen({ onCambio }: { onCambio: (b: Blob | null) => void }) {
  const [vista, setVista] = useState<string>();
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      if (vista) URL.revokeObjectURL(vista);
    },
    [vista],
  );

  async function elegir(archivo: File | undefined) {
    setError('');
    if (!archivo) return;
    setProcesando(true);
    try {
      const blob = await comprimirImagen(archivo);
      setVista(URL.createObjectURL(blob));
      onCambio(blob);
    } catch (e) {
      setError((e as Error).message || 'No se pudo leer la imagen');
      onCambio(null);
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div>
      <span className="etiqueta">Foto (opcional)</span>
      <div className="flex items-center gap-3">
        {vista ? (
          <img src={vista} alt="Vista previa" className="h-24 w-24 rounded-xl object-cover" />
        ) : (
          <div className="grid h-24 w-24 place-items-center rounded-xl bg-marca-50 text-3xl text-marca-200">
            📷
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label className="boton-secundario cursor-pointer">
            {procesando ? 'Procesando…' : 'Tomar foto'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => elegir(e.target.files?.[0])}
            />
          </label>
          <label className="cursor-pointer text-center text-sm text-marca-700 underline">
            Elegir de la galería
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => elegir(e.target.files?.[0])}
            />
          </label>
        </div>
      </div>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
