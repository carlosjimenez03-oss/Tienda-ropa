export interface DatosProducto {
  nombre: string;
  sku?: string | null;
  talla?: string | null;
  color?: string | null;
  precio?: number | null;
  stock_minimo?: number | null;
}

function textoOpcional(v: string | null | undefined, max: number, campo: string): string | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  if (t.length > max) throw new Error(`${campo}: máximo ${max} caracteres`);
  return t;
}

export function validarProducto(d: DatosProducto) {
  const nombre = (d.nombre ?? '').trim();
  if (!nombre) throw new Error('El nombre es obligatorio');
  if (nombre.length > 200) throw new Error('El nombre admite como máximo 200 caracteres');
  let precio: number | null = null;
  if (d.precio !== null && d.precio !== undefined && !Number.isNaN(d.precio)) {
    if (d.precio < 0) throw new Error('El precio no puede ser negativo');
    if (d.precio > 9_999_999_999) throw new Error('Precio demasiado alto');
    precio = Math.round(d.precio * 100) / 100;
  }
  let stock_minimo = 2;
  if (d.stock_minimo !== null && d.stock_minimo !== undefined && !Number.isNaN(d.stock_minimo)) {
    if (!Number.isInteger(d.stock_minimo) || d.stock_minimo < 0) {
      throw new Error('El aviso de pocas unidades debe ser un número entero de 0 o más');
    }
    stock_minimo = d.stock_minimo;
  }
  return {
    nombre,
    stock_minimo,
    sku: textoOpcional(d.sku, 100, 'SKU'),
    talla: textoOpcional(d.talla, 30, 'Talla'),
    color: textoOpcional(d.color, 50, 'Color'),
    precio,
  };
}

export function validarMovimiento(d: { cantidad: number; tipo: string; nota?: string }) {
  if (d.tipo !== 'entrada' && d.tipo !== 'salida') throw new Error('Tipo de movimiento inválido');
  if (!Number.isInteger(d.cantidad) || d.cantidad <= 0)
    throw new Error('La cantidad debe ser un entero mayor que 0');
  if (d.cantidad > 1_000_000) throw new Error('Cantidad demasiado alta');
  if (d.nota && d.nota.length > 500) throw new Error('La nota admite como máximo 500 caracteres');
}

export function validarPrecio(v: number | null | undefined, campo = 'El precio'): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  if (v < 0) throw new Error(`${campo} no puede ser negativo`);
  if (v > 9_999_999_999) throw new Error(`${campo} es demasiado alto`);
  return Math.round(v * 100) / 100;
}
