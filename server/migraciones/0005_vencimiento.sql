-- Tiempo de acceso por usuario: a partir de esta fecha no puede entrar.
-- null = sin límite.
alter table usuarios add column vence_en timestamptz;
