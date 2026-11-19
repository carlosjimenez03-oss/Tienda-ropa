import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { api, ErrorApi } from '../api';
import { useSesion } from '../auth/sesion';
import { db } from '../db/local';
import { sincronizar, useEstadoSync } from '../sync/engine';
import { haceTiempo } from '../componentes/BarraEstado';
import { esInstalada, esIOS } from '../componentes/AvisoInstalacion';

function msj(e: unknown) {
  return e instanceof ErrorApi
    ? e.message !== e.codigo
      ? e.message
      : e.codigo.replace(/_/g, ' ')
    : (e as Error).message;
}

function Sincronizacion() {
  const { sincronizando, enLinea, ultimoError } = useEstadoSync();
  const pendientes = useLiveQuery(
    () => db.outbox.where('estado').equals('pendiente').count(),
    [],
    0,
  );
  const errores = useLiveQuery(() => db.outbox.where('estado').equals('error').toArray(), [], []);
  const ultimo = useLiveQuery(
    async () => (await db.meta.get('ultimo_sync'))?.valor as string | undefined,
    [],
  );
  const [persistente, setPersistente] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage
      ?.persisted?.()
      .then(setPersistente)
      .catch(() => {});
  }, []);

  return (
    <section className="tarjeta space-y-3">
      <h2 className="text-lg font-semibold">Sincronización</h2>
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-stone-500">Conexión</dt>
        <dd>{enLinea ? 'En línea' : 'Sin conexión'}</dd>
        <dt className="text-stone-500">Cambios pendientes</dt>
        <dd data-testid="pendientes">{pendientes}</dd>
        <dt className="text-stone-500">Última sincronización</dt>
        <dd>{haceTiempo(ultimo)}</dd>
        <dt className="text-stone-500">Almacenamiento persistente</dt>
        <dd>
          {persistente === null
            ? '—'
            : persistente
              ? 'Sí'
              : 'No (el navegador podría borrar datos)'}
        </dd>
      </dl>
      {ultimoError && <p className="text-sm text-red-700">{ultimoError}</p>}
      {errores.length > 0 && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">{errores.length} cambios rechazados por el servidor:</p>
          <ul className="mt-1 list-disc pl-5">
            {errores.slice(0, 10).map((e) => (
              <li key={e.id}>
                {e.tabla}: {e.error}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-3">
            <button
              className="underline"
              onClick={async () => {
                await db.outbox
                  .where('estado')
                  .equals('error')
                  .modify({ estado: 'pendiente', intentos: 0, proximo_intento: undefined });
                sincronizar();
              }}
            >
              Reintentar
            </button>
            <button
              className="underline"
              onClick={async () => {
                if (confirm('¿Descartar estos cambios? No se podrán recuperar.')) {
                  await db.outbox.where('estado').equals('error').delete();
                }
              }}
            >
              Descartar
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="boton-primario" onClick={() => sincronizar()} disabled={sincronizando}>
          {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>
        {!persistente && (
          <button
            className="boton-secundario"
            onClick={async () => setPersistente((await navigator.storage?.persist?.()) ?? false)}
          >
            Pedir almacenamiento persistente
          </button>
        )}
      </div>
      {esIOS() && !esInstalada() && (
        <p className="text-sm text-amber-800">
          En iPhone/iPad instala la app (Compartir → Añadir a pantalla de inicio) para que Safari no
          borre los datos guardados sin conexión.
        </p>
      )}
    </section>
  );
}

function Seguridad() {
  const { estado, refrescar } = useSesion();
  const usuario = estado.tipo === 'autenticado' ? estado.usuario : null;
  const [config, setConfig] = useState<{ qr: string; secreto: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [aviso, setAviso] = useState('');
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');

  async function correr(fn: () => Promise<void>) {
    setAviso('');
    try {
      await fn();
    } catch (e) {
      setAviso(msj(e));
    }
  }

  return (
    <section className="tarjeta space-y-4">
      <h2 className="text-lg font-semibold">Seguridad</h2>
      <div>
        <h3 className="font-medium">Verificación en dos pasos (TOTP)</h3>
        {usuario?.mfa_activo ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              correr(async () => {
                await api('/api/auth/mfa/desactivar', { body: { codigo } });
                setCodigo('');
                await refrescar();
              });
            }}
          >
            <input
              className="campo"
              placeholder="Código actual"
              inputMode="numeric"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
            />
            <button className="boton-secundario shrink-0">Desactivar</button>
          </form>
        ) : config ? (
          <form
            className="mt-2 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              correr(async () => {
                await api('/api/auth/mfa/activar', { body: { codigo } });
                setConfig(null);
                setCodigo('');
                await refrescar();
              });
            }}
          >
            <p className="text-sm text-stone-600">
              Escanea el código con Google Authenticator, Microsoft Authenticator o similar, y
              escribe el código de 6 dígitos.
            </p>
            <img src={config.qr} alt="Código QR para la app autenticadora" className="h-48 w-48" />
            <p className="break-all font-mono text-xs text-stone-500">{config.secreto}</p>
            <div className="flex gap-2">
              <input
                className="campo"
                inputMode="numeric"
                placeholder="123456"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
              <button className="boton-primario shrink-0">Activar</button>
            </div>
          </form>
        ) : (
          <button
            className="boton-secundario mt-2"
            onClick={() =>
              correr(async () =>
                setConfig(await api('/api/auth/mfa/configurar', { method: 'POST' })),
              )
            }
          >
            Configurar
          </button>
        )}
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          correr(async () => {
            await api('/api/auth/contrasena', { body: { actual, nueva } });
            setActual('');
            setNueva('');
            setAviso('Contraseña actualizada.');
          });
        }}
      >
        <h3 className="font-medium">Cambiar contraseña</h3>
        <input
          className="campo"
          type="password"
          autoComplete="current-password"
          placeholder="Contraseña actual (si tienes)"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
        />
        <input
          className="campo"
          type="password"
          autoComplete="new-password"
          placeholder="Nueva (mínimo 10 caracteres)"
          minLength={10}
          required
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
        />
        <button className="boton-secundario">Guardar contraseña</button>
      </form>
      {aviso && <p className="text-sm text-stone-700">{aviso}</p>}
    </section>
  );
}

interface Usuaria {
  id: string;
  email: string;
  nombre: string;
  rol: 'admin' | 'usuaria';
  activo: boolean;
  mfa_activo: boolean;
  google: boolean;
  apple: boolean;
}

function Usuarias() {
  const [lista, setLista] = useState<Usuaria[] | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', nombre: '', contrasena: '', rol: 'usuaria' });

  const cargar = () =>
    api<{ usuarias: Usuaria[] }>('/api/usuarias')
      .then((r) => setLista(r.usuarias))
      .catch((e) => setError(msj(e)));
  useEffect(() => {
    cargar();
  }, []);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/api/usuarias', { body: { ...form, contrasena: form.contrasena || undefined } });
      setForm({ email: '', nombre: '', contrasena: '', rol: 'usuaria' });
      cargar();
    } catch (err) {
      setError(msj(err));
    }
  }

  async function cambiar(id: string, cambios: Record<string, unknown>) {
    setError('');
    try {
      await api(`/api/usuarias/${id}`, { method: 'PATCH', body: cambios });
      cargar();
    } catch (err) {
      setError(msj(err));
    }
  }

  return (
    <section className="tarjeta space-y-3">
      <h2 className="text-lg font-semibold">Usuarias</h2>
      {lista === null ? (
        <p className="text-sm text-stone-500">{error || 'Cargando… (requiere conexión)'}</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {lista.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className={`font-medium ${u.activo ? '' : 'line-through'}`}>
                  {u.nombre || u.email}
                </div>
                <div className="text-xs text-stone-500">
                  {u.email} · {u.rol}
                  {u.mfa_activo && ' · 2FA'}
                  {u.google && ' · Google'}
                  {u.apple && ' · Apple'}
                </div>
              </div>
              <button className="underline" onClick={() => cambiar(u.id, { activo: !u.activo })}>
                {u.activo ? 'Desactivar' : 'Activar'}
              </button>
              <button
                className="underline"
                onClick={() => {
                  const c = prompt('Nueva contraseña (mínimo 10 caracteres):');
                  if (c) cambiar(u.id, { contrasena: c });
                }}
              >
                Contraseña
              </button>
              {u.mfa_activo && (
                <button
                  className="underline"
                  onClick={() =>
                    confirm('¿Quitar la verificación en dos pasos?') &&
                    cambiar(u.id, { quitar_mfa: true })
                  }
                >
                  Quitar 2FA
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={crear} className="grid gap-2 sm:grid-cols-2">
        <input
          className="campo"
          type="email"
          placeholder="Correo"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          className="campo"
          placeholder="Nombre"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
        />
        <input
          className="campo"
          type="password"
          autoComplete="new-password"
          placeholder="Contraseña (vacía = solo Google/Apple)"
          value={form.contrasena}
          onChange={(e) => setForm({ ...form, contrasena: e.target.value })}
        />
        <select
          className="campo"
          value={form.rol}
          onChange={(e) => setForm({ ...form, rol: e.target.value })}
        >
          <option value="usuaria">Usuaria</option>
          <option value="admin">Administración</option>
        </select>
        <button className="boton-primario sm:col-span-2">Dar de alta</button>
      </form>
      {error && lista !== null && <p className="text-sm text-red-700">{error}</p>}
      <p className="text-xs text-stone-500">
        Para entrar con Google o Apple, la cuenta debe estar dada de alta aquí con el mismo correo.
      </p>
    </section>
  );
}

export function Ajustes() {
  const { estado, salir } = useSesion();
  const usuario = estado.tipo === 'autenticado' ? estado.usuario : null;

  async function cerrarSesion() {
    const pendientes = await db.outbox.count();
    if (
      pendientes > 0 &&
      !confirm(
        `Hay ${pendientes} cambios sin sincronizar. Se conservarán en este dispositivo y se subirán cuando alguien vuelva a entrar. ¿Cerrar sesión?`,
      )
    ) {
      return;
    }
    await salir();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Ajustes</h1>
      <section className="tarjeta flex items-center gap-3">
        <div className="flex-1">
          <div className="font-semibold">{usuario?.nombre || usuario?.email}</div>
          <div className="text-sm text-stone-500">{usuario?.email}</div>
        </div>
        <button className="boton-secundario" onClick={cerrarSesion}>
          Cerrar sesión
        </button>
      </section>
      <Sincronizacion />
      <Seguridad />
      {usuario?.rol === 'admin' && <Usuarias />}
    </div>
  );
}
