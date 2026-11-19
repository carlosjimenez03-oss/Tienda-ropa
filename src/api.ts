export class ErrorApi extends Error {
  constructor(
    public estado: number,
    public codigo: string,
    mensaje?: string,
  ) {
    super(mensaje ?? codigo);
  }
}

export class SinConexion extends Error {
  constructor() {
    super('Sin conexión con el servidor');
  }
}

type Escucha = () => void;
const alExpirar = new Set<Escucha>();
export function alExpirarSesion(fn: Escucha): () => void {
  alExpirar.add(fn);
  return () => alExpirar.delete(fn);
}

export async function api<T>(
  ruta: string,
  opciones: {
    method?: string;
    body?: unknown;
    raw?: Blob;
    contentType?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'x-inventario': '1' };
  let body: BodyInit | undefined;
  if (opciones.raw) {
    body = opciones.raw;
    headers['content-type'] = opciones.contentType ?? opciones.raw.type;
  } else if (opciones.body !== undefined) {
    body = JSON.stringify(opciones.body);
    headers['content-type'] = 'application/json';
  }
  let r: Response;
  try {
    r = await fetch(ruta, {
      method: opciones.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'same-origin',
      signal: opciones.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SinConexion();
  }
  if (r.status === 502 || r.status === 503 || r.status === 504) throw new SinConexion();
  const datos = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) {
    if (r.status === 401 && !ruta.startsWith('/api/auth/')) alExpirar.forEach((f) => f());
    throw new ErrorApi(r.status, datos?.error ?? `http_${r.status}`, datos?.mensaje);
  }
  return datos as T;
}
