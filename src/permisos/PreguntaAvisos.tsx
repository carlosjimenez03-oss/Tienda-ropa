import { useState } from 'react';
import { Dialogo } from './Dialogo';
import { debePreguntarAvisos, marcarAvisosPreguntado, pedirNotificaciones } from './dispositivo';

/**
 * Primera apertura de la app: se pregunta si se quieren avisos. Al tocar
 * "Permitir" el teléfono muestra su propio cuadro (Permitir / Bloquear).
 */
export function PreguntaAvisos() {
  const [visible, setVisible] = useState(debePreguntarAvisos);
  if (!visible) return null;

  const cerrar = () => {
    marcarAvisosPreguntado();
    setVisible(false);
  };

  return (
    <Dialogo
      icono="🔔"
      titulo="¿Activar los avisos?"
      onCerrar={cerrar}
      acciones={
        <>
          <button
            className="boton-primario w-full"
            onClick={async () => {
              await pedirNotificaciones();
              cerrar();
            }}
          >
            Permitir
          </button>
          <button className="boton-secundario w-full" onClick={cerrar}>
            Ahora no
          </button>
        </>
      }
    >
      <p>
        Te avisaremos cuando un producto <strong>se esté acabando</strong> para que lo repongas a
        tiempo.
      </p>
      <p className="mt-2 text-sm text-stone-500">
        Puedes cambiarlo cuando quieras en Ajustes → Permisos de la app.
      </p>
    </Dialogo>
  );
}
