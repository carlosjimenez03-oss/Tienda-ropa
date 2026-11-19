import { useEffect } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { usePermisos, useSesion } from '../auth/sesion';
import { CambioObligatorio } from '../auth/CambioObligatorio';
import type { Permiso } from '../../shared/permisos';
import { Login } from '../auth/Login';
import { iniciarMotor } from '../sync/engine';
import { BarraEstado } from '../componentes/BarraEstado';
import { AvisoInstalacion } from '../componentes/AvisoInstalacion';
import { Productos } from '../pantallas/Productos';
import { NuevoProducto } from '../pantallas/NuevoProducto';
import { DetalleProducto } from '../pantallas/DetalleProducto';
import { Movimientos } from '../pantallas/Movimientos';
import { Ajustes } from '../pantallas/Ajustes';
import { Inicio } from '../pantallas/Inicio';
import { useLiveQuery } from 'dexie-react-hooks';
import { cargarProductos } from '../dominio/consultas';

const ENLACES: { a: string; texto: string; icono: string; requiere?: Permiso[] }[] = [
  { a: '/', texto: 'Inicio', icono: '📊' },
  { a: '/productos', texto: 'Productos', icono: '👗' },
  {
    a: '/movimientos',
    texto: 'Vender',
    icono: '🛒',
    requiere: ['puede_vender', 'puede_agregar_mercancia'],
  },
  { a: '/nuevo', texto: 'Nuevo', icono: '➕', requiere: ['puede_editar_productos'] },
  { a: '/ajustes', texto: 'Ajustes', icono: '⚙️' },
];

export function App() {
  const { estado } = useSesion();
  const permisos = usePermisos();
  const debeCambiar = estado.tipo === 'autenticado' && estado.usuario.debe_cambiar_contrasena;
  const autenticado = estado.tipo === 'autenticado' && !debeCambiar;
  const alertas = useLiveQuery(
    async () => (await cargarProductos()).filter((f) => f.estado !== 'ok').length,
    [],
    0,
  );

  useEffect(() => {
    if (!autenticado) return;
    navigator.storage?.persist?.().catch(() => {});
    return iniciarMotor();
  }, [autenticado]);

  if (estado.tipo === 'cargando') {
    return <div className="grid min-h-dvh place-items-center text-stone-500">Cargando…</div>;
  }
  if (estado.tipo !== 'autenticado') {
    return <Login expirada={estado.tipo === 'expirada' ? estado.usuario : undefined} />;
  }
  if (debeCambiar) return <CambioObligatorio usuario={estado.usuario} />;
  const enlaces = ENLACES.filter((e) => !e.requiere || e.requiere.some((p) => permisos[p]));

  return (
    <div className="min-h-dvh md:flex">
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:static md:min-h-dvh md:w-56 md:flex-col md:border-r md:border-t-0 md:p-3">
        <div className="hidden px-3 py-4 text-lg font-bold text-marca-700 md:block">Inventario</div>
        {enlaces.map((e) => (
          <NavLink
            key={e.a}
            to={e.a}
            end={e.a === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium md:flex-none md:flex-row md:gap-3 md:rounded-xl md:px-3 md:py-3 md:text-base ${
                isActive ? 'text-marca-700 md:bg-marca-50' : 'text-stone-500 hover:text-stone-800'
              }`
            }
          >
            <span aria-hidden className="relative text-xl">
              {e.icono}
              {e.a === '/' && alertas > 0 && (
                <span className="absolute -right-3 -top-1 min-w-5 rounded-full bg-amber-500 px-1 text-center text-[11px] font-bold leading-5 text-white">
                  {alertas}
                </span>
              )}
            </span>
            {e.texto}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1 pb-24 md:pb-0">
        <BarraEstado />
        <AvisoInstalacion />
        <main className="mx-auto max-w-5xl p-4 md:p-6">
          <Routes>
            <Route path="/" element={<Inicio />} />
            <Route path="/productos" element={<Productos />} />
            <Route
              path="/nuevo"
              element={
                permisos.puede_editar_productos ? <NuevoProducto /> : <Navigate to="/" replace />
              }
            />
            <Route path="/producto/:id" element={<DetalleProducto />} />
            <Route
              path="/movimientos"
              element={
                permisos.puede_vender || permisos.puede_agregar_mercancia ? (
                  <Movimientos />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route path="/ajustes" element={<Ajustes />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
