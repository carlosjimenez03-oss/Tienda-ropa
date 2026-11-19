import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { api, ErrorApi, SinConexion } from '../api';
import { db } from '../db/local';
import { useSesion } from './sesion';
import type { UsuarioPublico } from '../../shared/esquemas';

const ERRORES: Record<string, string> = {
  credenciales_invalidas: 'Correo o contraseña incorrectos.',
  cuenta_bloqueada_temporalmente: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.',
  codigo_invalido: 'El código no es válido.',
  datos_invalidos: 'Revisa los datos.',
  http_429: 'Demasiados intentos. Espera un minuto.',
};

function mensaje(e: unknown): string {
  if (e instanceof SinConexion) return 'Sin conexión. Necesitas internet para iniciar sesión.';
  if (e instanceof ErrorApi) return ERRORES[e.codigo] ?? e.message;
  return (e as Error).message;
}

export function Login({ expirada }: { expirada?: UsuarioPublico }) {
  const { entrar } = useSesion();
  const params = new URLSearchParams(location.search);
  const [email, setEmail] = useState(expirada?.email ?? '');
  const [contrasena, setContrasena] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pasoMfa, setPasoMfa] = useState(params.get('mfa') === '1');
  const [error, setError] = useState(
    params.get('error') ? mensaje(new ErrorApi(0, params.get('error')!)) : '',
  );
  const [enviando, setEnviando] = useState(false);
  const pendientes = useLiveQuery(() => db.outbox.count(), [], 0);

  useEffect(() => {
    if (params.has('error') || params.has('mfa')) history.replaceState(null, '', '/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      if (pasoMfa) {
        const r = await api<{ usuario: UsuarioPublico }>('/api/auth/mfa/verificar', {
          body: { codigo },
        });
        await entrar(r.usuario);
      } else {
        const r = await api<{ usuario?: UsuarioPublico; mfa?: boolean }>('/api/auth/entrar', {
          body: { email, contrasena },
        });
        if (r.mfa) setPasoMfa(true);
        else if (r.usuario) await entrar(r.usuario);
      }
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-b from-marca-50 to-white p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/iconos/icono.svg" alt="" className="mx-auto mb-3 h-16 w-16" />
          <h1 className="text-2xl font-bold text-stone-900">Inventario</h1>
          <p className="text-stone-500">Ropa y accesorios</p>
        </div>

        {expirada && (
          <div
            className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            role="status"
          >
            Tu sesión expiró. Vuelve a entrar para seguir sincronizando.
            {pendientes > 0 && (
              <>
                {' '}
                Tus <strong>{pendientes} cambios pendientes</strong> están guardados en este
                dispositivo y no se perderán.
              </>
            )}
          </div>
        )}

        <form onSubmit={enviar} className="tarjeta space-y-4">
          {pasoMfa ? (
            <div>
              <label className="etiqueta" htmlFor="codigo">
                Código de verificación (app autenticadora)
              </label>
              <input
                id="codigo"
                className="campo text-center text-2xl tracking-widest"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                autoFocus
                required
              />
            </div>
          ) : (
            <>
              <div>
                <label className="etiqueta" htmlFor="email">
                  Correo
                </label>
                <input
                  id="email"
                  type="email"
                  className="campo"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="etiqueta" htmlFor="contrasena">
                  Contraseña
                </label>
                <input
                  id="contrasena"
                  type="password"
                  className="campo"
                  autoComplete="current-password"
                  value={contrasena}
                  onChange={(e) => setContrasena(e.target.value)}
                  required
                />
              </div>
            </>
          )}
          {error && (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <button className="boton-primario w-full" disabled={enviando}>
            {enviando ? 'Entrando…' : pasoMfa ? 'Verificar' : 'Entrar'}
          </button>
          {pasoMfa && (
            <button
              type="button"
              className="w-full text-sm text-stone-500"
              onClick={() => setPasoMfa(false)}
            >
              Volver
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
