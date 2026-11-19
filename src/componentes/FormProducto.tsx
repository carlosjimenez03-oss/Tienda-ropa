import type { DatosProducto } from '../dominio/validaciones';

export interface ValoresForm {
  nombre: string;
  sku: string;
  talla: string;
  color: string;
  precio: string;
}

export const formVacio: ValoresForm = { nombre: '', sku: '', talla: '', color: '', precio: '' };

export function aDatos(v: ValoresForm): DatosProducto {
  const precio = v.precio.trim() === '' ? null : Number(v.precio.replace(',', '.'));
  if (precio !== null && Number.isNaN(precio)) throw new Error('El precio no es un número válido');
  return { nombre: v.nombre, sku: v.sku, talla: v.talla, color: v.color, precio };
}

export function CamposProducto({ v, set }: { v: ValoresForm; set: (v: ValoresForm) => void }) {
  const campo = (k: keyof ValoresForm) => ({
    value: v[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ ...v, [k]: e.target.value }),
  });
  return (
    <>
      <div>
        <label className="etiqueta" htmlFor="nombre">
          Nombre *
        </label>
        <input id="nombre" className="campo" required maxLength={200} {...campo('nombre')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta" htmlFor="talla">
            Talla
          </label>
          <input id="talla" className="campo" maxLength={30} {...campo('talla')} />
        </div>
        <div>
          <label className="etiqueta" htmlFor="color">
            Color
          </label>
          <input id="color" className="campo" maxLength={50} {...campo('color')} />
        </div>
        <div>
          <label className="etiqueta" htmlFor="precio">
            Precio (RD$)
          </label>
          <input id="precio" className="campo" inputMode="decimal" {...campo('precio')} />
        </div>
        <div>
          <label className="etiqueta" htmlFor="sku">
            SKU / referencia
          </label>
          <input id="sku" className="campo" maxLength={100} {...campo('sku')} />
        </div>
      </div>
    </>
  );
}
