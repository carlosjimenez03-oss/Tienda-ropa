import { useEffect, useRef, useState } from 'react';
import { abrirCamara, CamaraBloqueada, pasosAjustesSistema } from './dispositivo';

/**
 * Cámara dentro de la app, a pantalla completa. Al abrirse, si el permiso aún no
 * se decidió (o se eligió "Solo esta vez"), el teléfono muestra su cuadro de permiso.
 */
export function CamaraEnVivo({
  onFoto,
  onCerrar,
  onUsarSistema,
}: {
  onFoto: (foto: Blob) => void;
  onCerrar: () => void;
  /** Alternativa: abrir la cámara del teléfono (no requiere permiso de la app). */
  onUsarSistema: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [frontal, setFrontal] = useState(false);
  const [estado, setEstado] = useState<'abriendo' | 'lista' | 'bloqueada' | 'error'>('abriendo');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    let flujo: MediaStream | null = null;
    let vivo = true;
    setEstado('abriendo');
    abrirCamara(frontal)
      .then((f) => {
        if (!vivo) return f.getTracks().forEach((t) => t.stop());
        flujo = f;
        if (video.current) {
          const v = video.current;
          // El disparador aparece cuando ya hay imagen, para que el toque nunca se pierda
          v.addEventListener('loadeddata', () => vivo && setEstado('lista'), { once: true });
          v.srcObject = f;
          v.play().catch(() => {});
        }
      })
      .catch((e) => {
        if (!vivo) return;
        if (e instanceof CamaraBloqueada) setEstado('bloqueada');
        else {
          setMensaje((e as Error).message);
          setEstado('error');
        }
      });
    return () => {
      vivo = false;
      flujo?.getTracks().forEach((t) => t.stop());
    };
  }, [frontal]);

  function disparar() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const lienzo = document.createElement('canvas');
    lienzo.width = v.videoWidth;
    lienzo.height = v.videoHeight;
    lienzo.getContext('2d')!.drawImage(v, 0, 0);
    lienzo.toBlob((b) => b && onFoto(b), 'image/jpeg', 0.92);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Cámara"
    >
      <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button className="rounded-full bg-white/15 px-4 py-2" onClick={onCerrar}>
          Cancelar
        </button>
        {estado === 'lista' && (
          <button
            className="rounded-full bg-white/15 px-4 py-2"
            onClick={() => setFrontal((f) => !f)}
            aria-label="Cambiar de cámara"
          >
            🔄
          </button>
        )}
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="h-full w-full object-contain" />
        {estado === 'abriendo' && (
          <p className="absolute inset-0 grid place-items-center p-6 text-center">
            Abriendo la cámara… Si el teléfono pregunta, elige una opción para continuar.
          </p>
        )}
        {(estado === 'bloqueada' || estado === 'error') && (
          <div className="absolute inset-0 overflow-auto bg-black p-6">
            <div className="mx-auto max-w-sm space-y-4">
              <p className="text-4xl" aria-hidden>
                📷
              </p>
              {estado === 'bloqueada' ? (
                <>
                  <h2 className="text-xl font-semibold">La cámara no tiene permiso</h2>
                  <p className="text-white/80">
                    Se rechazó el permiso de cámara para esta app. Para usarla, cámbialo en tu
                    teléfono:
                  </p>
                  <ol className="list-decimal space-y-1 pl-5 text-white/90">
                    {pasosAjustesSistema('camara').map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ol>
                </>
              ) : (
                <p>{mensaje}</p>
              )}
              <button className="boton w-full bg-white text-stone-900" onClick={onUsarSistema}>
                Usar la cámara del teléfono
              </button>
            </div>
          </div>
        )}
      </div>

      {estado === 'lista' && (
        <div className="flex justify-center p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <button
            onClick={disparar}
            aria-label="Tomar foto"
            className="h-20 w-20 rounded-full border-4 border-white bg-white/30 active:scale-95"
          />
        </div>
      )}
    </div>
  );
}
