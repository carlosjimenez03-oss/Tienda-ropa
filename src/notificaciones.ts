/**
 * Avisos del sistema (notificaciones del teléfono/PC) cuando un producto se está
 * acabando. Son opcionales: si no hay permiso, la app sigue mostrando los avisos
 * dentro de la propia pantalla.
 * En iPhone/iPad solo funcionan con la app instalada (iOS 16.4 o superior).
 */
export function notificacionesDisponibles(): boolean {
  return typeof Notification !== 'undefined';
}

export function permisoNotificaciones(): NotificationPermission | 'no_disponible' {
  return notificacionesDisponibles() ? Notification.permission : 'no_disponible';
}

export async function pedirPermisoNotificaciones(): Promise<boolean> {
  if (!notificacionesDisponibles()) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

export async function notificarStockBajo(nombre: string, quedan: number): Promise<void> {
  if (!notificacionesDisponibles() || Notification.permission !== 'granted') return;
  const titulo = quedan <= 0 ? `Se agotó: ${nombre}` : `Se está acabando: ${nombre}`;
  const opciones: NotificationOptions = {
    body:
      quedan <= 0 ? 'No quedan unidades. Hay que reponer.' : `Quedan ${quedan}. Conviene reponer.`,
    icon: '/iconos/icono-192.png',
    badge: '/iconos/icono-192.png',
    tag: `stock-${nombre}`,
  };
  try {
    // En Android las notificaciones deben salir desde el service worker
    const registro = await navigator.serviceWorker?.getRegistration();
    if (registro) await registro.showNotification(titulo, opciones);
    else new Notification(titulo, opciones);
  } catch {
    /* el aviso dentro de la app ya se mostró */
  }
}
