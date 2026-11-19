export const LADO_MAXIMO = 1000;

export function dimensionesEscaladas(ancho: number, alto: number, max = LADO_MAXIMO) {
  const mayor = Math.max(ancho, alto);
  if (mayor <= max) return { ancho, alto };
  const f = max / mayor;
  return { ancho: Math.round(ancho * f), alto: Math.round(alto * f) };
}

function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((ok) => canvas.toBlob(ok, tipo, calidad));
}

/**
 * Redimensiona a 1000 px como máximo en el lado mayor y convierte a WebP (calidad 0.8).
 * Si el navegador no sabe codificar WebP (Safari antiguo) usa JPEG.
 */
export async function comprimirImagen(archivo: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  const { ancho, alto } = dimensionesEscaladas(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la imagen');
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();
  const webp = await aBlob(canvas, 'image/webp', 0.8);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await aBlob(canvas, 'image/jpeg', 0.8);
  if (!jpeg) throw new Error('No se pudo comprimir la imagen');
  return jpeg;
}
