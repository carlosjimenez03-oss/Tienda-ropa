import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { alExpirarSesion, api, ErrorApi, SinConexion } from '../api';
import { db, guardarMeta, leerMeta } from '../db/local';
import type { UsuarioPublico } from '../../shared/esquemas';
import { PERMISOS, type Permisos } from '../../shared/permisos';

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'anonimo' }
  | { tipo: 'autenticado'; usuario: UsuarioPublico }
  | { tipo: 'expirada'; usuario: UsuarioPublico };

interface ContextoSesion {
  estado: Estado;
  entrar: (usuario: UsuarioPublico) => Promise<void>;
  salir: () => Promise<void>;
  refrescar: () => Promise<void>;
}

const Ctx = createContext<ContextoSesion | null>(null);
const CLAVE = 'usuario';

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });

  const refrescar = useCallback(async () => {
    const guardado = await leerMeta<UsuarioPublico>(CLAVE);
    // Offline-first: si hay una usuaria guardada se entra de inmediato y se valida en segundo plano.
    if (guardado) setEstado({ tipo: 'autenticado', usuario: guardado });
    try {
      const { usuario } = await api<{ usuario: UsuarioPublico }>('/api/auth/yo');
      await guardarMeta(CLAVE, usuario);
      setEstado({ tipo: 'autenticado', usuario });
    } catch (e) {
      if (e instanceof SinConexion) {
        if (!guardado) setEstado({ tipo: 'anonimo' });
      } else if (e instanceof ErrorApi && e.estado === 401) {
        setEstado(guardado ? { tipo: 'expirada', usuario: guardado } : { tipo: 'anonimo' });
      } else if (!guardado) {
        setEstado({ tipo: 'anonimo' });
      }
    }
  }, []);

  useEffect(() => {
    refrescar();
    return alExpirarSesion(() =>
      setEstado((e) => (e.tipo === 'autenticado' ? { tipo: 'expirada', usuario: e.usuario } : e)),
    );
  }, [refrescar]);

  const entrar = useCallback(async (usuario: UsuarioPublico) => {
    await guardarMeta(CLAVE, usuario);
    setEstado({ tipo: 'autenticado', usuario });
  }, []);

  const salir = useCallback(async () => {
    try {
      await api('/api/auth/salir', { method: 'POST' });
    } catch {
      /* sin red: se borra igualmente la sesión local */
    }
    await db.meta.delete(CLAVE);
    setEstado({ tipo: 'anonimo' });
  }, []);

  return <Ctx.Provider value={{ estado, entrar, salir, refrescar }}>{children}</Ctx.Provider>;
}

/** Permisos de la persona conectada (todos falsos si no hay sesión). */
export function usePermisos(): Permisos {
  const { estado } = useSesion();
  if (estado.tipo !== 'autenticado' && estado.tipo !== 'expirada') {
    return Object.fromEntries(PERMISOS.map((p) => [p, false])) as Permisos;
  }
  return (
    estado.usuario.permisos ?? (Object.fromEntries(PERMISOS.map((p) => [p, false])) as Permisos)
  );
}

export function useSesion(): ContextoSesion {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSesion fuera de ProveedorSesion');
  return c;
}
