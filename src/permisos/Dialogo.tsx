import { useEffect, useRef, type ReactNode } from 'react';

/** Ventana modal sencilla, al estilo de los avisos de permiso de una app nativa. */
export function Dialogo({
  titulo,
  icono,
  children,
  acciones,
  onCerrar,
}: {
  titulo: string;
  icono?: string;
  children: ReactNode;
  acciones: ReactNode;
  onCerrar?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar?.();
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-4 sm:place-items-center">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialogo-titulo"
        className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl"
      >
        {icono && (
          <div
            className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-marca-50 text-3xl"
            aria-hidden
          >
            {icono}
          </div>
        )}
        <h2 id="dialogo-titulo" className="text-lg font-semibold">
          {titulo}
        </h2>
        <div className="mt-2 text-stone-600">{children}</div>
        <div className="mt-5 flex flex-col gap-2">{acciones}</div>
      </div>
    </div>
  );
}
