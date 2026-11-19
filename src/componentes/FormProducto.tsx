import type { DatosProducto } from '../dominio/validaciones';

export interface ValoresForm {
  nombre: string;
  sku: string;
  talla: string;
  color: string;
  precio: string;
  stock_minimo: string;
}

export const formVacio: ValoresForm = {
  nombre: '',
  sku: '',
  talla: '',
  color: '',
  precio: '',
  stock_minimo: '2',
};

/** Convierte texto escrito por la persona ("1,200.50", "1200") en número. */
export function aNumero(texto: string, campo: string): number | null {
  const t = texto.trim().replace(/\s|RD\$|\$/g, '');
  if (t === '') return null;
  // Formato dominicano: la coma separa miles ("1,000" o "1,250.50").
  // Solo se toma la coma como decimal si no encaja en grupos de miles ("12,5").
  const normal = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)
    ? t.replace(/,/g, '')
    : t.includes('.')
      ? t.replace(/,/g, '')
      : t.replace(',', '.');
  const n = Number(normal);
  if (Number.isNaN(n)) throw new Error(`${campo}: escribe solo números`);
  return n;
}

export function aDatos(v: ValoresForm): DatosProducto {
  return {
    nombre: v.nombre,
    sku: v.sku,
    talla: v.talla,
    color: v.color,
    precio: aNumero(v.precio, 'Precio'),
    stock_minimo: aNumero(v.stock_minimo, 'Aviso de pocas unidades'),
  };
}

export function CamposProducto({ v, set }: { v: ValoresForm; set: (v: ValoresForm) => void }) {
  const campo = (k: keyof ValoresForm) => ({
    value: v[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ ...v, [k]: e.target.value }),
  });
  return (
    <>
      <div>
        <label className="etiqueta text-base" htmlFor="nombre">
          Nombre del producto
        </label>
        <input
          id="nombre"
          className="campo"
          required
          maxLength={200}
          placeholder="Ej.: Blusa de lino"
          autoCapitalize="sentences"
          {...campo('nombre')}
        />
      </div>
      <div>
        <label className="etiqueta text-base" htmlFor="precio">
          Precio de venta (RD$)
        </label>
        <input
          id="precio"
          className="campo"
          inputMode="decimal"
          placeholder="Ej.: 1200"
          {...campo('precio')}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta" htmlFor="talla">
            Talla
          </label>
          <input
            id="talla"
            className="campo"
            maxLength={30}
            placeholder="Ej.: M"
            {...campo('talla')}
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor="color">
            Color
          </label>
          <input
            id="color"
            className="campo"
            maxLength={50}
            placeholder="Ej.: Rojo"
            {...campo('color')}
          />
        </div>
      </div>
      <div>
        <label className="etiqueta" htmlFor="stock_minimo">
          Avisarme cuando queden
        </label>
        <div className="flex items-center gap-2">
          <input
            id="stock_minimo"
            className="campo w-28"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            {...campo('stock_minimo')}
          />
          <span className="text-stone-600">unidades o menos</span>
        </div>
      </div>
      <details open={Boolean(v.sku)}>
        <summary className="cursor-pointer text-sm text-stone-600">Más detalles (opcional)</summary>
        <div className="mt-2">
          <label className="etiqueta" htmlFor="sku">
            Referencia o código del proveedor
          </label>
          <input id="sku" className="campo" maxLength={100} {...campo('sku')} />
        </div>
      </details>
    </>
  );
}
