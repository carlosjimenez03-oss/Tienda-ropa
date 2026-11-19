import { useEffect } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useSesion } from '../auth/sesion';
import { Login } from '../auth/Login';
import { iniciarMotor } from '../sync/engine';
import { BarraEstado } from '../componentes/BarraEstado';
import { AvisoInstalacion } from '../componentes/AvisoInstalacion';
import { Productos } from '../pantallas/Productos';
import { NuevoProducto } from '../pantallas/NuevoProducto';
import { DetalleProducto } from '../pantallas/DetalleProducto';
import { Movimientos } from '../pantallas/Movimientos';
import { Ajustes } from '../pantallas/Ajustes';

const ENLACES = [
  { a: '/', texto: 'Productos', icono: '👗' },
  { a: '/movimientos', texto: 'Movimientos', icono: '↕️' },
  { a: '/nuevo', texto: 'Nuevo', icono: '➕' },
  { a: '/ajustes', texto: 'Ajustes', icono: '⚙️' },
];

export function App() {
  const { estado } = useSesion();
  const autenticado = estado.tipo === 'autenticado';

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

  return (
    <div className="min-h-dvh md:flex">
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:static md:min-h-dvh md:w-56 md:flex-col md:border-r md:border-t-0 md:p-3">
        <div className="hidden px-3 py-4 text-lg font-bold text-marca-700 md:block">Inventario</div>
        {ENLACES.map((e) => (
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
            <span aria-hidden className="text-xl">
              {e.icono}
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
            <Route path="/" element={<Productos />} />
            <Route path="/nuevo" element={<NuevoProducto />} />
            <Route path="/producto/:id" element={<DetalleProducto />} />
            <Route path="/movimientos" element={<Movimientos />} />
            <Route path="/ajustes" element={<Ajustes />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
