import { useEffect, useState } from 'react';

interface EventoInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

function leer(clave: string) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

export function esIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function esInstalada(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function AvisoInstalacion() {
  const [evento, setEvento] = useState<EventoInstalacion | null>(null);
  const [cerrado, setCerrado] = useState(() => leer('aviso-instalacion-cerrado') === '1');

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setEvento(e as EventoInstalacion);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  if (cerrado || esInstalada()) return null;
  const cerrar = () => {
    try {
      localStorage.setItem('aviso-instalacion-cerrado', '1');
    } catch {
      /* ignorar */
    }
    setCerrado(true);
  };

  if (evento) {
    return (
      <div className="m-4 flex items-center gap-3 rounded-2xl border border-marca-200 bg-marca-50 p-3 md:mx-6">
        <span className="flex-1 text-sm">
          Instala la app para usarla sin internet y abrirla desde el inicio.
        </span>
        <button
          className="boton-primario min-h-10 px-3 text-sm"
          onClick={async () => {
            await evento.prompt();
            setEvento(null);
          }}
        >
          Instalar
        </button>
        <button className="text-stone-500" onClick={cerrar} aria-label="Cerrar">
          ✕
        </button>
      </div>
    );
  }

  if (esIOS()) {
    return (
      <div className="m-4 rounded-2xl border border-marca-200 bg-marca-50 p-3 text-sm md:mx-6">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <strong>Instala la app en tu iPhone o iPad:</strong>
            <ol className="mt-1 list-decimal pl-5">
              <li>
                Toca <strong>Compartir</strong> <span aria-hidden>⬆️</span> en Safari.
              </li>
              <li>
                Elige <strong>Añadir a pantalla de inicio</strong>.
              </li>
              <li>Abre la app desde el nuevo icono.</li>
            </ol>
          </div>
          <button className="text-stone-500" onClick={cerrar} aria-label="Cerrar">
            ✕
          </button>
        </div>
      </div>
    );
  }
  return null;
}
