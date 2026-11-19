-- Esquema base del inventario.
create extension if not exists pgcrypto;

create table usuarios (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique check (email = lower(email) and length(email) between 3 and 254),
  nombre           text not null default '' check (length(nombre) <= 120),
  hash_contrasena  text,
  rol              text not null default 'usuaria' check (rol in ('admin','usuaria')),
  activo           boolean not null default true,
  google_sub       text unique,
  apple_sub        text unique,
  totp_secreto     text,
  totp_activo      boolean not null default false,
  intentos_fallidos integer not null default 0,
  bloqueado_hasta  timestamptz,
  creado_en        timestamptz not null default now()
);

create table sesiones (
  id            text primary key,           -- sha256 del token
  usuario_id    uuid not null references usuarios(id) on delete cascade,
  mfa_pendiente boolean not null default false,
  creado_en     timestamptz not null default now(),
  expira_en     timestamptz not null,
  ultimo_uso    timestamptz not null default now()
);
create index on sesiones (usuario_id);
create index on sesiones (expira_en);

-- Versión global monotónica para la sincronización incremental.
create sequence sync_version;

create table productos (
  id             uuid primary key,
  nombre         text not null check (length(nombre) between 1 and 200),
  sku            text,
  talla          text,
  color          text,
  precio         numeric(12,2) check (precio >= 0),
  creado_por     uuid not null references usuarios(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado      boolean not null default false,
  version        bigint not null default nextval('sync_version')
);

create table lotes (
  id          uuid primary key,
  codigo      text not null unique check (codigo ~ '^[0-9]{8}-[A-Z2-9]{4}$'),
  producto_id uuid not null references productos(id),
  creado_por  uuid not null references usuarios(id),
  creado_en   timestamptz not null default now(),
  version     bigint not null default nextval('sync_version')
);

create table movimientos (
  id              uuid primary key,
  lote_id         uuid not null references lotes(id),
  tipo            text not null check (tipo in ('entrada','salida')),
  cantidad        integer not null check (cantidad > 0),
  nota            text,
  usuario_id      uuid not null references usuarios(id),
  ocurrido_en     timestamptz not null,
  sincronizado_en timestamptz not null default now(),
  eliminado       boolean not null default false,
  version         bigint not null default nextval('sync_version')
);

create table imagenes (
  id          uuid primary key,
  producto_id uuid not null references productos(id),
  ruta        text not null,
  creado_por  uuid not null references usuarios(id),
  creado_en   timestamptz not null default now(),
  eliminado   boolean not null default false,
  version     bigint not null default nextval('sync_version')
);

create index on productos (version);
create index on lotes (version);
create index on movimientos (version);
create index on imagenes (version);
create index on lotes (producto_id);
create index on movimientos (lote_id);
create index on imagenes (producto_id);
create index on productos (actualizado_en);
create index on movimientos (sincronizado_en);

-- Cada UPDATE asigna una versión nueva para que el pull incremental la vea.
create function tocar_version() returns trigger language plpgsql as $$
begin
  new.version := nextval('sync_version');
  return new;
end $$;

create trigger productos_version before update on productos for each row execute function tocar_version();
create trigger lotes_version before update on lotes for each row execute function tocar_version();
create trigger movimientos_version before update on movimientos for each row execute function tocar_version();
create trigger imagenes_version before update on imagenes for each row execute function tocar_version();

-- Los movimientos son append-only: solo se permite marcar como anulado.
create function movimientos_inmutables() returns trigger language plpgsql as $$
begin
  if new.lote_id <> old.lote_id or new.tipo <> old.tipo or new.cantidad <> old.cantidad
     or new.usuario_id <> old.usuario_id or new.ocurrido_en <> old.ocurrido_en
     or (old.eliminado and not new.eliminado) then
    raise exception 'movimientos es append-only: solo se permite anular';
  end if;
  return new;
end $$;
create trigger movimientos_append_only before update on movimientos for each row execute function movimientos_inmutables();
create rule movimientos_sin_borrado as on delete to movimientos do instead nothing;

-- Vista de comprobación de stock por lote.
create view stock_lotes as
select l.id as lote_id, l.codigo, l.producto_id,
       coalesce(sum(case when m.tipo = 'entrada' then m.cantidad else -m.cantidad end)
                filter (where not m.eliminado), 0)::integer as stock
from lotes l left join movimientos m on m.lote_id = l.id
group by l.id;
