import { useSyncExternalStore } from 'react';
import { ErrorApi, SinConexion } from '../api';
import { backoff } from '../db/outbox';
import { pull } from './pull';
import { push } from './push';

export interface EstadoSync {
  sincronizando: boolean;
  enLinea: boolean;
  ultimoError: string | null;
}

let estado: EstadoSync = {
  sincronizando: false,
  enLinea: typeof navigator === 'undefined' ? true : navigator.onLine,
  ultimoError: null,
};
const escuchas = new Set<() => void>();
function fijar(parcial: Partial<EstadoSync>) {
  estado = { ...estado, ...parcial };
  escuchas.forEach((f) => f());
}

export function useEstadoSync(): EstadoSync {
  return useSyncExternalStore(
    (f) => {
      escuchas.add(f);
      return () => escuchas.delete(f);
    },
    () => estado,
  );
}

let enCurso: Promise<void> | null = null;
let repetir = false;
let fallosSeguidos = 0;
let temporizadorReintento: ReturnType<typeof setTimeout> | undefined;
let habilitado = false;

export function sincronizar(): Promise<void> {
  if (!habilitado) return Promise.resolve();
  if (enCurso) {
    repetir = true;
    return enCurso;
  }
  enCurso = (async () => {
    fijar({ sincronizando: true });
    try {
      do {
        repetir = false;
        await push();
        await pull();
      } while (repetir);
      fallosSeguidos = 0;
      fijar({ ultimoError: null, enLinea: true });
    } catch (e) {
      fallosSeguidos++;
      if (e instanceof SinConexion) {
        fijar({ enLinea: false, ultimoError: null });
      } else if (e instanceof ErrorApi && e.estado === 401) {
        fijar({ ultimoError: 'La sesión expiró' });
        return;
      } else {
        fijar({ ultimoError: (e as Error).message });
      }
      clearTimeout(temporizadorReintento);
      temporizadorReintento = setTimeout(sincronizar, backoff(fallosSeguidos));
    } finally {
      fijar({ sincronizando: false });
      enCurso = null;
    }
  })();
  return enCurso;
}

let temporizadorDebounce: ReturnType<typeof setTimeout> | undefined;
/** Pide una sincronización pronto (tras un cambio local). */
export function programarSync(ms = 800) {
  clearTimeout(temporizadorDebounce);
  temporizadorDebounce = setTimeout(sincronizar, ms);
}

export function iniciarMotor(): () => void {
  habilitado = true;
  const enLinea = () => {
    fijar({ enLinea: true });
    fallosSeguidos = 0;
    sincronizar();
  };
  const fueraDeLinea = () => fijar({ enLinea: false });
  const visible = () => {
    if (document.visibilityState === 'visible') sincronizar();
  };
  window.addEventListener('online', enLinea);
  window.addEventListener('offline', fueraDeLinea);
  document.addEventListener('visibilitychange', visible);
  const intervalo = setInterval(sincronizar, 5 * 60_000);
  sincronizar();
  return () => {
    habilitado = false;
    window.removeEventListener('online', enLinea);
    window.removeEventListener('offline', fueraDeLinea);
    document.removeEventListener('visibilitychange', visible);
    clearInterval(intervalo);
    clearTimeout(temporizadorReintento);
  };
}
