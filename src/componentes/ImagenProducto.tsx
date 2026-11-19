import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/local';

/** Muestra la imagen local (blob) mientras no se haya subido; luego la remota (cacheada por el SW). */
export function ImagenProducto({
  id,
  className = '',
  alt = '',
}: {
  id?: string;
  className?: string;
  alt?: string;
}) {
  const local = useLiveQuery(() => (id ? db.imagenes_locales.get(id) : undefined), [id]);
  const [url, setUrl] = useState<string>();
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    if (!id) return setUrl(undefined);
    if (local?.blob) {
      const u = URL.createObjectURL(local.blob);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setUrl(`/api/imagenes/${id}`);
  }, [id, local]);

  if (!id || !url || fallo) {
    return (
      <div
        className={`grid place-items-center bg-marca-50 text-2xl text-marca-200 ${className}`}
        aria-hidden
      >
        👚
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={`object-cover ${className}`}
      onError={() => setFallo(true)}
    />
  );
}
