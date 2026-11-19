-- Defensa en profundidad: RLS activado en todas las tablas de datos.
-- La aplicación se conecta como el dueño de las tablas (que omite RLS salvo
-- FORCE); cualquier otro rol que se cree en la base (p. ej. para reportes)
-- no verá nada sin una política explícita.
alter table usuarios    enable row level security;
alter table sesiones    enable row level security;
alter table productos   enable row level security;
alter table lotes       enable row level security;
alter table movimientos enable row level security;
alter table imagenes    enable row level security;

revoke all on all tables in schema public from public;
