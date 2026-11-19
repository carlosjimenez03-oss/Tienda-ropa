import { useState, type FormEvent } from 'react';
import { api, ErrorApi, SinConexion } from '../api';
import { useSesion } from './sesion';
import type { UsuarioPublico } from '../../shared/esquemas';

const ERRORES: Record<string, string> = {
  contrasena_actual_incorrecta: 'La contraseña temporal no es correcta.',
  contrasena_repetida: 'La nueva contraseña debe ser distinta de la temporal.',
};

/**
 * Pantalla que aparece la primera vez que alguien entra (o después de que le
 * restablezcan la contraseña). No se puede usar la app hasta cambiarla.
 */
export function CambioObligatorio({ usuario }: { usuario: UsuarioPublico }) {
  const { entrar, salir } = useSesion();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (nueva.length < 10)
      return setError('La nueva contraseña debe tener al menos 10 caracteres.');
    if (nueva !== repetir) return setError('Las dos contraseñas nuevas no coinciden.');
    setEnviando(true);
    try {
      const r = await api<{ usuario: UsuarioPublico }>('/api/auth/contrasena', {
        body: { actual, nueva },
      });
      await entrar(r.usuario);
    } catch (err) {
      if (err instanceof SinConexion) setError('Necesitas internet para cambiar la contraseña.');
      else if (err instanceof ErrorApi) setError(ERRORES[err.codigo] ?? err.message);
      else setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-b from-marca-50 to-white p-4">
      <form onSubmit={guardar} className="tarjeta w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-bold">Crea tu contraseña</h1>
          <p className="mt-1 text-stone-600">
            Hola{usuario.nombre ? `, ${usuario.nombre}` : ''}. Estás usando una contraseña temporal.
            Por seguridad, crea una nueva que solo tú conozcas.
          </p>
        </div>
        <div>
          <label className="etiqueta" htmlFor="actual">
            Contraseña temporal
          </label>
          <input
            id="actual"
            type="password"
            className="campo"
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor="nueva">
            Nueva contraseña (mínimo 10 caracteres)
          </label>
          <input
            id="nueva"
            type="password"
            className="campo"
            autoComplete="new-password"
            minLength={10}
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor="repetir">
            Repite la nueva contraseña
          </label>
          <input
            id="repetir"
            type="password"
            className="campo"
            autoComplete="new-password"
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
            required
          />
        </div>
        {error && (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        <button className="boton-primario w-full" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar y entrar'}
        </button>
        <button type="button" className="w-full text-sm text-stone-500 underline" onClick={salir}>
          Salir
        </button>
      </form>
    </div>
  );
}
