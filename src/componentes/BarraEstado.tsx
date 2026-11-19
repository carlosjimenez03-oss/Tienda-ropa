import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/local';
import { sincronizar, useEstadoSync } from '../sync/engine';

const DIAS_AVISO = 5;

export function haceTiempo(iso: string | undefined, ahora = Date.now()): string {
  if (!iso) return 'nunca';
  const min = Math.floor((ahora - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

export function BarraEstado() {
  const { sincronizando, enLinea, ultimoError } = useEstadoSync();
  const pendientes = useLiveQuery(
    () => db.outbox.where('estado').equals('pendiente').count(),
    [],
    0,
  );
  const conError = useLiveQuery(() => db.outbox.where('estado').equals('error').count(), [], 0);
  const ultimo = useLiveQuery(
    async () => (await db.meta.get('ultimo_sync'))?.valor as string | undefined,
    [],
  );
  const [, tic] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tic((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const viejo = ultimo ? Date.now() - new Date(ultimo).getTime() > DIAS_AVISO * 86400_000 : true;

  let texto: string;
  let color = 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (!enLinea) {
    texto =
      pendientes > 0
        ? `Sin internet · ${pendientes} cambios guardados en este equipo`
        : 'Sin internet · puedes seguir trabajando';
    color = 'bg-amber-50 text-amber-900 border-amber-200';
  } else if (sincronizando) {
    texto = 'Enviando cambios…';
    color = 'bg-sky-50 text-sky-800 border-sky-200';
  } else if (pendientes > 0) {
    texto = `${pendientes} cambios por enviar`;
    color = 'bg-amber-50 text-amber-900 border-amber-200';
  } else {
    texto = `Todo al día · sincronizado ${haceTiempo(ultimo)}`;
  }

  return (
    <div className="sticky top-0 z-10 pt-[env(safe-area-inset-top)]">
      <button
        onClick={() => sincronizar()}
        className={`flex w-full items-center justify-center gap-2 border-b px-3 py-1.5 text-sm ${color}`}
        data-testid="estado-sync"
      >
        <span
          className={`h-2 w-2 rounded-full ${enLinea ? 'bg-emerald-500' : 'bg-amber-500'}`}
          aria-hidden
        />
        {texto}
        {(ultimoError || conError > 0) && (
          <span className="text-red-700">
            · {conError > 0 ? `${conError} con error` : ultimoError}
          </span>
        )}
      </button>
      {pendientes > 0 && viejo && (
        <div
          className="border-b border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-800"
          role="alert"
        >
          Hace más de {DIAS_AVISO} días que no se sincroniza y hay cambios sin subir. Conéctate a
          internet y abre la app para no perderlos.
        </div>
      )}
    </div>
  );
}
