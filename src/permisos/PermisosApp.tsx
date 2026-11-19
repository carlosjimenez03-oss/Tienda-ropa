import { useState, type ReactNode } from 'react';
import { notificarStockBajo } from '../notificaciones';
import { CamaraEnVivo } from './CamaraEnVivo';
import {
  appInstalada,
  avisosActivos,
  fijarAvisosActivos,
  pasosAjustesSistema,
  pedirNotificaciones,
  plataforma,
  useEstadoPermiso,
  type EstadoPermiso,
  type PermisoDispositivo,
} from './dispositivo';

const ETIQUETA: Record<EstadoPermiso, { texto: string; clase: string }> = {
  permitido: { texto: 'Permitido', clase: 'bg-emerald-100 text-emerald-800' },
  bloqueado: { texto: 'Bloqueado', clase: 'bg-red-100 text-red-800' },
  preguntar: { texto: 'Preguntar cada vez', clase: 'bg-stone-100 text-stone-700' },
  no_disponible: { texto: 'No disponible', clase: 'bg-stone-100 text-stone-500' },
};

function Interruptor({
  activo,
  onCambio,
  etiqueta,
}: {
  activo: boolean;
  onCambio: (v: boolean) => void;
  etiqueta: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      onClick={() => onCambio(!activo)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition ${
        activo ? 'bg-marca-700' : 'bg-stone-300'
      }`}
    >
      <span
        className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${
          activo ? 'left-7' : 'left-1'
        }`}
      />
    </button>
  );
}

function Pasos({ permiso, titulo }: { permiso: PermisoDispositivo; titulo: string }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-marca-700 underline">{titulo}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-stone-700">
        {pasosAjustesSistema(permiso).map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ol>
    </details>
  );
}

function Fila({
  icono,
  nombre,
  descripcion,
  estado,
  textoPreguntar,
  children,
}: {
  icono: string;
  nombre: string;
  descripcion: string;
  estado: EstadoPermiso | null;
  /** Texto alternativo para el estado "preguntar" */
  textoPreguntar?: string;
  children?: ReactNode;
}) {
  return (
    <li className="space-y-2 py-4" data-testid={`permiso-${nombre}`}>
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-marca-50 text-xl"
          aria-hidden
        >
          {icono}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{nombre}</div>
          <div className="text-sm text-stone-500">{descripcion}</div>
        </div>
        {estado && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ETIQUETA[estado].clase}`}
          >
            {estado === 'preguntar' && textoPreguntar ? textoPreguntar : ETIQUETA[estado].texto}
          </span>
        )}
      </div>
      <div className="space-y-2 pl-[3.25rem]">{children}</div>
    </li>
  );
}

/** Ajustes → Permisos de la app: como la pantalla de permisos de una app nativa. */
export function PermisosApp() {
  const [notif, refrescarNotif] = useEstadoPermiso('notificaciones');
  const [camara, refrescarCamara] = useEstadoPermiso('camara');
  const [almacen, refrescarAlmacen] = useEstadoPermiso('almacenamiento');
  const [avisos, setAvisos] = useState(avisosActivos);
  const [probarCamara, setProbarCamara] = useState(false);
  const so = plataforma();

  return (
    <section className="tarjeta">
      <h2 className="text-lg font-semibold">Permisos de la app</h2>
      <p className="text-sm text-stone-500">
        Los cuadros de permiso los muestra tu {so === 'otro' ? 'navegador' : 'teléfono'}. Para
        quitar un permiso ya concedido hay que hacerlo en sus ajustes; aquí te indicamos cómo.
      </p>
      <ul className="divide-y divide-stone-100">
        <Fila
          icono="🔔"
          nombre="Notificaciones"
          descripcion="Avisos cuando un producto se está acabando"
          estado={notif}
        >
          {notif === 'permitido' && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Recibir avisos en este equipo</span>
                <Interruptor
                  etiqueta="Recibir avisos en este equipo"
                  activo={avisos}
                  onCambio={(v) => {
                    fijarAvisosActivos(v);
                    setAvisos(v);
                  }}
                />
              </div>
              {avisos && (
                <button
                  className="text-sm underline"
                  onClick={() => notificarStockBajo('Producto de prueba', 1)}
                >
                  Enviar un aviso de prueba
                </button>
              )}
              <Pasos permiso="notificaciones" titulo="Quitar el permiso en el teléfono" />
            </>
          )}
          {notif === 'preguntar' && (
            <button
              className="boton-primario min-h-10"
              onClick={async () => {
                await pedirNotificaciones();
                setAvisos(avisosActivos());
                refrescarNotif();
              }}
            >
              Permitir notificaciones
            </button>
          )}
          {notif === 'bloqueado' && (
            <>
              <p className="text-sm text-stone-600">
                Las rechazaste antes. Para activarlas, cámbialo en los ajustes:
              </p>
              <Pasos permiso="notificaciones" titulo="Ver cómo activarlas" />
            </>
          )}
          {notif === 'no_disponible' && (
            <p className="text-sm text-stone-600">
              {so === 'ios' && !appInstalada()
                ? 'En iPhone/iPad instala primero la app (Compartir → Añadir a pantalla de inicio) y ábrela desde el icono.'
                : 'Este navegador no permite notificaciones. Los avisos se verán dentro de la app.'}
            </p>
          )}
        </Fila>

        <Fila icono="📷" nombre="Cámara" descripcion="Fotografiar los productos" estado={camara}>
          {camara === 'preguntar' && (
            <>
              <p className="text-sm text-stone-600">
                Se te preguntará al tomar una foto: solo esta vez, mientras usas la app o no
                permitir.
              </p>
              <button className="boton-secundario min-h-10" onClick={() => setProbarCamara(true)}>
                Permitir ahora
              </button>
            </>
          )}
          {camara === 'permitido' && (
            <Pasos permiso="camara" titulo="Quitar el permiso en el teléfono" />
          )}
          {camara === 'bloqueado' && (
            <>
              <p className="text-sm text-stone-600">
                Puedes seguir usando la cámara del teléfono o la galería. Para usar la cámara dentro
                de la app:
              </p>
              <Pasos permiso="camara" titulo="Ver cómo permitirla" />
            </>
          )}
          {camara === 'no_disponible' && (
            <p className="text-sm text-stone-600">
              Se usará la cámara del teléfono al tomar fotos.
            </p>
          )}
        </Fila>

        <Fila
          icono="💾"
          nombre="Guardar datos sin internet"
          descripcion="Evita que el teléfono borre las ventas guardadas sin conexión"
          estado={almacen}
          textoPreguntar="Sin activar"
        >
          {almacen === 'preguntar' && (
            <button
              className="boton-secundario min-h-10"
              onClick={async () => {
                await navigator.storage?.persist?.();
                refrescarAlmacen();
              }}
            >
              Permitir
            </button>
          )}
          {almacen === 'preguntar' && so === 'ios' && !appInstalada() && (
            <p className="text-sm text-amber-800">
              En iPhone/iPad instala la app para que Safari no borre los datos.
            </p>
          )}
        </Fila>
      </ul>

      {probarCamara && (
        <CamaraEnVivo
          onCerrar={() => {
            setProbarCamara(false);
            refrescarCamara();
          }}
          onFoto={() => {
            setProbarCamara(false);
            refrescarCamara();
          }}
          onUsarSistema={() => {
            setProbarCamara(false);
            refrescarCamara();
          }}
        />
      )}
    </section>
  );
}
