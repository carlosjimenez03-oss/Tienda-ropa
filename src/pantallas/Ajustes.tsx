import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { api, ErrorApi, SinConexion } from '../api';
import { usePermisos, useSesion } from '../auth/sesion';
import {
  DESCRIPCION_PERMISO,
  PERMISOS,
  PERMISOS_POR_DEFECTO,
  type Permisos,
} from '../../shared/permisos';
import { db } from '../db/local';
import { sincronizar, useEstadoSync } from '../sync/engine';
import { haceTiempo } from '../componentes/BarraEstado';
import { esInstalada, esIOS } from '../componentes/AvisoInstalacion';
import {
  notificarStockBajo,
  pedirPermisoNotificaciones,
  permisoNotificaciones,
} from '../notificaciones';

const MENSAJES: Record<string, string> = {
  codigo_invalido: 'El código no es correcto. Revisa la app autenticadora e inténtalo de nuevo.',
  contrasena_actual_incorrecta: 'La contraseña actual no es correcta.',
  email_existente: 'Ya existe una cuenta con ese correo.',
  permiso_no_concedible: 'No puedes dar un permiso que tú no tienes.',
  sin_permiso: 'No tienes permiso para hacer esto.',
  contrasena_repetida: 'La nueva contraseña debe ser distinta de la actual.',
  contrasena_debil: 'La contraseña debe tener al menos 10 caracteres.',
  datos_invalidos: 'Revisa los datos: falta algo o tiene un formato incorrecto.',
  sesion_requerida: 'Tu sesión expiró. Vuelve a entrar.',
};

function msj(e: unknown) {
  if (e instanceof SinConexion)
    return 'Necesitas internet para esto. Inténtalo cuando vuelva la conexión.';
  if (e instanceof ErrorApi)
    return (
      MENSAJES[e.codigo] ??
      (e.message !== e.codigo ? e.message : 'Algo salió mal. Inténtalo de nuevo.')
    );
  return (e as Error).message;
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
          {sincronizando ? 'Sincronizando…' : 'Enviar cambios ahora'}
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

function Avisos() {
  const [permiso, setPermiso] = useState(permisoNotificaciones);
  return (
    <section className="tarjeta space-y-3">
      <h2 className="text-lg font-semibold">Avisos de productos por acabarse</h2>
      <p className="text-sm text-stone-600">
        Cada producto tiene un número de aviso (por defecto 2). Cuando una venta deja ese número o
        menos, la app lo muestra en <strong>Inicio</strong> y en la lista de productos. También
        puede avisarte con una notificación del teléfono o la computadora.
      </p>
      {permiso === 'granted' ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-emerald-800">✅ Notificaciones activadas</span>
          <button
            className="text-sm underline"
            onClick={() => notificarStockBajo('Producto de prueba', 1)}
          >
            Enviar una de prueba
          </button>
        </div>
      ) : permiso === 'denied' ? (
        <p className="text-sm text-amber-800">
          Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador para este
          sitio.
        </p>
      ) : permiso === 'no_disponible' ? (
        <p className="text-sm text-stone-600">
          Este navegador no permite notificaciones
          {esIOS()
            ? ': en iPhone/iPad instala primero la app (Compartir → Añadir a pantalla de inicio).'
            : '.'}{' '}
          Los avisos seguirán apareciendo dentro de la app.
        </p>
      ) : (
        <button
          className="boton-secundario"
          onClick={async () => {
            await pedirPermisoNotificaciones();
            setPermiso(permisoNotificaciones());
          }}
        >
          🔔 Activar notificaciones
        </button>
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
          placeholder="Contraseña actual"
          required
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

interface UsuarioLista {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
  es_propietario: boolean;
  mfa_activo: boolean;
  debe_cambiar_contrasena: boolean;
  creado_por_email: string | null;
  gestionable: boolean;
  permisos: Permisos;
}

/** Casillas de permisos. Solo se pueden marcar los que tiene quien está creando. */
function CasillasPermisos({
  valor,
  onCambio,
  propios,
  prefijo,
}: {
  valor: Permisos;
  onCambio: (p: Permisos) => void;
  propios: Permisos;
  prefijo: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="etiqueta">¿Qué puede hacer?</legend>
      {PERMISOS.map((p) => {
        const bloqueado = !propios[p] && !valor[p];
        return (
          <label
            key={p}
            className={`flex items-start gap-3 rounded-xl border border-stone-200 p-3 ${
              bloqueado ? 'opacity-50' : 'cursor-pointer hover:bg-stone-50'
            }`}
          >
            <input
              id={`${prefijo}-${p}`}
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-marca-700"
              checked={valor[p]}
              disabled={bloqueado}
              onChange={(e) => onCambio({ ...valor, [p]: e.target.checked })}
            />
            <span>
              <span className="block font-medium">{DESCRIPCION_PERMISO[p].titulo}</span>
              <span className="block text-sm text-stone-500">
                {DESCRIPCION_PERMISO[p].detalle}
                {bloqueado && ' · no puedes darlo porque tú no lo tienes'}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Muestra una contraseña temporal una sola vez, para dictarla o copiarla. */
function ContrasenaTemporal({
  email,
  clave,
  onCerrar,
}: {
  email: string;
  clave: string;
  onCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="rounded-2xl border-2 border-emerald-400 bg-emerald-50 p-4" role="status">
      <p className="font-semibold text-emerald-900">✅ Listo. Entrega estos datos a la persona:</p>
      <dl className="mt-2 space-y-1">
        <div>
          <dt className="inline text-stone-600">Correo: </dt>
          <dd className="inline font-medium">{email}</dd>
        </div>
        <div>
          <dt className="inline text-stone-600">Contraseña temporal: </dt>
          <dd
            className="inline font-mono text-xl font-bold tracking-wider"
            data-testid="contrasena-temporal"
          >
            {clave}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-sm text-stone-600">
        Al entrar por primera vez se le pedirá crear su propia contraseña. Esta clave no se volverá
        a mostrar.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="boton-secundario min-h-10"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `Correo: ${email}\nContraseña temporal: ${clave}`,
              );
              setCopiado(true);
            } catch {
              /* sin portapapeles */
            }
          }}
        >
          {copiado ? 'Copiado ✓' : 'Copiar'}
        </button>
        <button type="button" className="boton-secundario min-h-10" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

function Usuarios() {
  const propios = usePermisos();
  const [lista, setLista] = useState<UsuarioLista[] | null>(null);
  const [error, setError] = useState('');
  const [creando, setCreando] = useState(false);
  const [form, setForm] = useState({
    email: '',
    nombre: '',
    permisos: { ...PERMISOS_POR_DEFECTO },
  });
  const [temporal, setTemporal] = useState<{ email: string; clave: string } | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [permisosEdicion, setPermisosEdicion] = useState<Permisos>(PERMISOS_POR_DEFECTO);

  const cargar = () =>
    api<{ usuarios: UsuarioLista[] }>('/api/usuarios')
      .then((r) => setLista(r.usuarios))
      .catch((e) => setError(msj(e)));
  useEffect(() => {
    cargar();
  }, []);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await api<{ contrasena_temporal: string }>('/api/usuarios', { body: form });
      setTemporal({ email: form.email.trim().toLowerCase(), clave: r.contrasena_temporal });
      setForm({ email: '', nombre: '', permisos: { ...PERMISOS_POR_DEFECTO } });
      setCreando(false);
      cargar();
    } catch (err) {
      setError(msj(err));
    }
  }

  async function cambiar(u: UsuarioLista, cambios: Record<string, unknown>) {
    setError('');
    try {
      const r = await api<{ contrasena_temporal?: string }>(`/api/usuarios/${u.id}`, {
        method: 'PATCH',
        body: cambios,
      });
      if (r.contrasena_temporal) setTemporal({ email: u.email, clave: r.contrasena_temporal });
      setEditando(null);
      cargar();
    } catch (err) {
      setError(msj(err));
    }
  }

  return (
    <section className="tarjeta space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-lg font-semibold">Usuarios</h2>
        {!creando && (
          <button className="boton-primario min-h-10" onClick={() => setCreando(true)}>
            + Crear usuario
          </button>
        )}
      </div>

      {temporal && (
        <ContrasenaTemporal
          email={temporal.email}
          clave={temporal.clave}
          onCerrar={() => setTemporal(null)}
        />
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}

      {creando && (
        <form onSubmit={crear} className="space-y-3 rounded-2xl border border-marca-200 p-4">
          <h3 className="font-semibold">Nuevo usuario</h3>
          <div>
            <label className="etiqueta" htmlFor="nuevo-email">
              Correo
            </label>
            <input
              id="nuevo-email"
              className="campo"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="nuevo-nombre">
              Nombre
            </label>
            <input
              id="nuevo-nombre"
              className="campo"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            />
          </div>
          <CasillasPermisos
            prefijo="nuevo"
            valor={form.permisos}
            propios={propios}
            onCambio={(permisos) => setForm({ ...form, permisos })}
          />
          <p className="text-sm text-stone-500">
            Se generará una contraseña temporal; la persona deberá cambiarla al entrar.
          </p>
          <div className="flex gap-2">
            <button className="boton-primario">Crear usuario</button>
            <button type="button" className="boton-secundario" onClick={() => setCreando(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {lista === null ? (
        <p className="text-sm text-stone-500">{error ? '' : 'Cargando… (requiere internet)'}</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {lista.map((u) => (
            <li key={u.id} className="py-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className={`font-medium ${u.activo ? '' : 'text-stone-400 line-through'}`}>
                    {u.nombre || u.email}
                    {u.es_propietario && (
                      <span className="ml-2 rounded-full bg-marca-100 px-2 py-0.5 text-xs text-marca-800">
                        Propietario
                      </span>
                    )}
                    {!u.activo && (
                      <span className="ml-2 text-xs text-stone-500">(desactivado)</span>
                    )}
                  </div>
                  <div className="text-sm text-stone-500">{u.email}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {PERMISOS.filter((p) => u.permisos[p]).map((p) => (
                      <span
                        key={p}
                        className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700"
                      >
                        {DESCRIPCION_PERMISO[p].titulo}
                      </span>
                    ))}
                    {u.debe_cambiar_contrasena && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                        Aún no ha cambiado la contraseña
                      </span>
                    )}
                    {u.mfa_activo && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                        Verificación en 2 pasos
                      </span>
                    )}
                  </div>
                  {u.creado_por_email && (
                    <div className="mt-1 text-xs text-stone-400">
                      Creado por {u.creado_por_email}
                    </div>
                  )}
                </div>
                {u.gestionable && editando !== u.id && (
                  <button
                    className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
                    onClick={() => {
                      setEditando(u.id);
                      setPermisosEdicion(u.permisos);
                    }}
                  >
                    Gestionar
                  </button>
                )}
              </div>
              {editando === u.id && (
                <div className="mt-3 space-y-3 rounded-2xl border border-stone-200 p-3">
                  <CasillasPermisos
                    prefijo={u.id}
                    valor={permisosEdicion}
                    propios={propios}
                    onCambio={setPermisosEdicion}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="boton-primario min-h-10"
                      onClick={() => cambiar(u, { permisos: permisosEdicion })}
                    >
                      Guardar permisos
                    </button>
                    <button
                      className="boton-secundario min-h-10"
                      onClick={() =>
                        confirm(`¿Generar una contraseña temporal nueva para ${u.email}?`) &&
                        cambiar(u, { restablecer_contrasena: true })
                      }
                    >
                      Nueva contraseña temporal
                    </button>
                    <button
                      className="boton-secundario min-h-10"
                      onClick={() =>
                        confirm(
                          u.activo
                            ? `¿Desactivar a ${u.email}? No podrá entrar.`
                            : `¿Activar de nuevo a ${u.email}?`,
                        ) && cambiar(u, { activo: !u.activo })
                      }
                    >
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    {u.mfa_activo && (
                      <button
                        className="boton-secundario min-h-10"
                        onClick={() =>
                          confirm('¿Quitar la verificación en dos pasos?') &&
                          cambiar(u, { quitar_mfa: true })
                        }
                      >
                        Quitar verificación en 2 pasos
                      </button>
                    )}
                    <button className="text-sm underline" onClick={() => setEditando(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
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
      <Avisos />
      <Sincronizacion />
      <Seguridad />
      {usuario?.permisos.puede_crear_usuarios && <Usuarios />}
    </div>
  );
}
