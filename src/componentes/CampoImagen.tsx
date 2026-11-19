import { useEffect, useRef, useState } from 'react';
import { comprimirImagen } from '../imagenes/comprimir';
import { CamaraEnVivo } from '../permisos/CamaraEnVivo';
import { Dialogo } from '../permisos/Dialogo';
import { consultarPermiso } from '../permisos/dispositivo';

export function CampoImagen({ onCambio }: { onCambio: (b: Blob | null) => void }) {
  const [vista, setVista] = useState<string>();
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');
  const [paso, setPaso] = useState<'nada' | 'explicar' | 'camara'>('nada');
  const camaraSistema = useRef<HTMLInputElement>(null);

  /** "Tomar foto": explica antes de que el teléfono pida el permiso de cámara. */
  async function tomarFoto() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      camaraSistema.current?.click();
      return;
    }
    const estado = await consultarPermiso('camara');
    setPaso(estado === 'preguntar' ? 'explicar' : 'camara');
  }

  useEffect(
    () => () => {
      if (vista) URL.revokeObjectURL(vista);
    },
    [vista],
  );

  async function elegir(archivo: Blob | undefined) {
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
          <button
            type="button"
            className="boton-secundario"
            onClick={tomarFoto}
            disabled={procesando}
          >
            {procesando ? 'Procesando…' : '📷 Tomar foto'}
          </button>
          {/* Cámara del sistema: alternativa si no hay cámara dentro de la app */}
          <input
            ref={camaraSistema}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => elegir(e.target.files?.[0])}
          />
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
      {paso === 'explicar' && (
        <Dialogo
          icono="📷"
          titulo="Permitir el uso de la cámara"
          onCerrar={() => setPaso('nada')}
          acciones={
            <>
              <button className="boton-primario w-full" onClick={() => setPaso('camara')}>
                Continuar
              </button>
              <button className="boton-secundario w-full" onClick={() => setPaso('nada')}>
                Ahora no
              </button>
            </>
          }
        >
          <p>La app usará la cámara solo para fotografiar tus productos.</p>
          <p className="mt-2 text-sm text-stone-500">
            A continuación tu teléfono te preguntará. Puedes permitirlo solo esta vez, mientras uses
            la app, o rechazarlo.
          </p>
        </Dialogo>
      )}
      {paso === 'camara' && (
        <CamaraEnVivo
          onCerrar={() => setPaso('nada')}
          onFoto={(foto) => {
            setPaso('nada');
            elegir(foto);
          }}
          onUsarSistema={() => {
            setPaso('nada');
            camaraSistema.current?.click();
          }}
        />
      )}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
