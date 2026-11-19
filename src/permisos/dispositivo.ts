import { useEffect, useState } from 'react';

/**
 * Permisos del dispositivo (notificaciones, cámara, almacenamiento).
 *
 * Los cuadros de "Permitir / Solo esta vez / No permitir" los muestra el propio
 * teléfono o navegador: una web no puede cambiar sus botones ni revocar un
 * permiso por sí misma. Aquí se consulta el estado, se pide en el momento
 * adecuado (siempre tras un toque de la persona, como exige iOS) y se guardan
 * las preferencias propias de la app (p. ej. apagar los avisos sin tocar el
 * permiso del sistema).
 */

export type EstadoPermiso = 'permitido' | 'bloqueado' | 'preguntar' | 'no_disponible';
export type PermisoDispositivo = 'notificaciones' | 'camara' | 'almacenamiento';

export function plataforma(): 'ios' | 'android' | 'otro' {
  if (typeof navigator === 'undefined') return 'otro';
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/i.test(ua)) return 'android';
  return 'otro';
}

export function appInstalada(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function desdeNavegador(e: PermissionState | NotificationPermission): EstadoPermiso {
  if (e === 'granted') return 'permitido';
  if (e === 'denied') return 'bloqueado';
  return 'preguntar';
}

export async function consultarPermiso(p: PermisoDispositivo): Promise<EstadoPermiso> {
  try {
    if (p === 'notificaciones') {
      if (typeof Notification === 'undefined') return 'no_disponible';
      return desdeNavegador(Notification.permission);
    }
    if (p === 'camara') {
      if (!navigator.mediaDevices?.getUserMedia) return 'no_disponible';
      try {
        const r = await navigator.permissions.query({ name: 'camera' as PermissionName });
        return desdeNavegador(r.state);
      } catch {
        return 'preguntar'; // el navegador no informa el estado; se sabrá al pedirlo
      }
    }
    if (!navigator.storage?.persisted) return 'no_disponible';
    return (await navigator.storage.persisted()) ? 'permitido' : 'preguntar';
  } catch {
    return 'no_disponible';
  }
}

/** Estado reactivo de un permiso: se actualiza si cambia en los ajustes del sistema. */
export function useEstadoPermiso(p: PermisoDispositivo): [EstadoPermiso | null, () => void] {
  const [estado, setEstado] = useState<EstadoPermiso | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let vivo = true;
    let status: PermissionStatus | null = null;
    const actualizar = () => consultarPermiso(p).then((e) => vivo && setEstado(e));
    actualizar();
    const nombre = p === 'camara' ? 'camera' : p === 'notificaciones' ? 'notifications' : null;
    if (nombre && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: nombre as PermissionName })
        .then((s) => {
          status = s;
          s.addEventListener('change', actualizar);
        })
        .catch(() => {});
    }
    // Al volver de los ajustes del teléfono, la app vuelve a estar visible
    document.addEventListener('visibilitychange', actualizar);
    return () => {
      vivo = false;
      status?.removeEventListener('change', actualizar);
      document.removeEventListener('visibilitychange', actualizar);
    };
  }, [p, version]);
  return [estado, () => setVersion((v) => v + 1)];
}

// ---------- Notificaciones ----------

const CLAVE_AVISOS = 'pref-avisos-activos';
const CLAVE_PREGUNTADO = 'pref-avisos-preguntado';

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}
function escribir(clave: string, valor: string) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento: se volverá a preguntar */
  }
}

/** Interruptor propio de la app: permite apagar los avisos sin ir a los ajustes del teléfono. */
export function avisosActivos(): boolean {
  return leer(CLAVE_AVISOS) !== 'no';
}
export function fijarAvisosActivos(v: boolean) {
  escribir(CLAVE_AVISOS, v ? 'si' : 'no');
}

/** ¿Hay que mostrar la pregunta de bienvenida sobre los avisos? */
export function debePreguntarAvisos(): boolean {
  return (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'default' &&
    leer(CLAVE_PREGUNTADO) === null
  );
}
export function marcarAvisosPreguntado() {
  escribir(CLAVE_PREGUNTADO, new Date().toISOString());
}

/** Debe llamarse desde un toque (botón): iOS solo muestra el cuadro así. */
export async function pedirNotificaciones(): Promise<EstadoPermiso> {
  if (typeof Notification === 'undefined') return 'no_disponible';
  const r = await Notification.requestPermission();
  if (r === 'granted') fijarAvisosActivos(true);
  return desdeNavegador(r);
}

// ---------- Cámara ----------

export class CamaraBloqueada extends Error {
  constructor() {
    super('El permiso de cámara está bloqueado');
  }
}

/** Abre la cámara. El teléfono muestra su cuadro de permiso si aún no se decidió. */
export async function abrirCamara(frontal = false): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: frontal ? 'user' : { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch (e) {
    const nombre = (e as DOMException).name;
    if (nombre === 'NotAllowedError' || nombre === 'SecurityError') throw new CamaraBloqueada();
    if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') {
      throw new Error('No se encontró una cámara en este equipo.');
    }
    throw new Error('No se pudo abrir la cámara.');
  }
}

// ---------- Instrucciones para cambiar el permiso en el sistema ----------

export function pasosAjustesSistema(p: PermisoDispositivo): string[] {
  const so = plataforma();
  const instalada = appInstalada();
  const nombre =
    p === 'camara' ? 'Cámara' : p === 'notificaciones' ? 'Notificaciones' : 'Almacenamiento';
  if (so === 'android') {
    return instalada
      ? [
          'Mantén presionado el icono de Inventario en la pantalla de inicio.',
          'Toca "Información de la aplicación" (ⓘ).',
          `Entra en "Permisos" (o "Configuración del sitio") → "${nombre}" y elige la opción que quieras.`,
        ]
      : [
          'Toca el icono junto a la dirección (arriba, a la izquierda).',
          'Toca "Permisos" o "Configuración del sitio".',
          `Cambia "${nombre}" a Permitir o Bloquear.`,
        ];
  }
  if (so === 'ios') {
    if (p === 'notificaciones') {
      return instalada
        ? [
            'Abre la app Ajustes del iPhone o iPad.',
            'Toca "Notificaciones" y busca "Inventario".',
            'Activa o desactiva "Permitir notificaciones".',
          ]
        : [
            'En iPhone/iPad los avisos solo funcionan con la app instalada.',
            'En Safari toca Compartir → "Añadir a pantalla de inicio".',
            'Abre la app desde el icono y vuelve aquí.',
          ];
    }
    return [
      'Abre la app Ajustes del iPhone o iPad.',
      'Toca "Apps" → "Safari" → "Cámara" (en versiones antiguas: Ajustes → Safari → Cámara).',
      'Elige "Preguntar", "Permitir" o "Denegar".',
    ];
  }
  return [
    'Haz clic en el icono del candado junto a la dirección.',
    `Cambia "${nombre}" a Permitir o Bloquear.`,
    'Recarga la página.',
  ];
}
