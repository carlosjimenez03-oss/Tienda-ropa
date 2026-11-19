export const PERMISOS = [
  'puede_vender',
  'puede_agregar_mercancia',
  'puede_editar_productos',
  'puede_ver_resumen',
  'puede_crear_usuarios',
] as const;

export type Permiso = (typeof PERMISOS)[number];
export type Permisos = Record<Permiso, boolean>;

export const DESCRIPCION_PERMISO: Record<Permiso, { titulo: string; detalle: string }> = {
  puede_vender: { titulo: 'Vender', detalle: 'Registrar ventas y deshacerlas' },
  puede_agregar_mercancia: {
    titulo: 'Agregar mercancía',
    detalle: 'Registrar la mercancía que llega y crear lotes nuevos',
  },
  puede_editar_productos: {
    titulo: 'Crear y editar productos',
    detalle: 'Agregar productos nuevos, cambiar precios y fotos, eliminarlos',
  },
  puede_ver_resumen: {
    titulo: 'Ver el resumen',
    detalle: 'Ver cuánto se ha vendido y comprado',
  },
  puede_crear_usuarios: {
    titulo: 'Crear usuarios',
    detalle: 'Dar de alta a otras personas y darles permisos (solo los que tenga esta persona)',
  },
};

export const PERMISOS_POR_DEFECTO: Permisos = {
  puede_vender: true,
  puede_agregar_mercancia: true,
  puede_editar_productos: false,
  puede_ver_resumen: false,
  puede_crear_usuarios: false,
};

export const TODOS_LOS_PERMISOS: Permisos = {
  puede_vender: true,
  puede_agregar_mercancia: true,
  puede_editar_productos: true,
  puede_ver_resumen: true,
  puede_crear_usuarios: true,
};

export function extraerPermisos(fila: Partial<Record<Permiso, unknown>>): Permisos {
  return Object.fromEntries(PERMISOS.map((p) => [p, fila[p] === true])) as Permisos;
}
