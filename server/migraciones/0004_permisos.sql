-- Permisos por persona (en lugar de roles), cuenta propietaria y cambio de
-- contraseña obligatorio. Se elimina el inicio de sesión con Google y Apple.
alter table usuarios
  add column es_propietario boolean not null default false,
  add column puede_vender boolean not null default true,
  add column puede_agregar_mercancia boolean not null default true,
  add column puede_editar_productos boolean not null default false,
  add column puede_ver_resumen boolean not null default false,
  add column puede_crear_usuarios boolean not null default false,
  add column debe_cambiar_contrasena boolean not null default false,
  add column creado_por uuid references usuarios(id);

-- Las cuentas de administración existentes conservan todos los permisos
update usuarios set puede_editar_productos = true, puede_ver_resumen = true, puede_crear_usuarios = true
 where rol = 'admin';
-- La primera cuenta de administración pasa a ser la propietaria
update usuarios set es_propietario = true
 where id = (select id from usuarios where rol = 'admin' order by creado_en limit 1);

create unique index usuarios_un_propietario on usuarios (es_propietario) where es_propietario;

alter table usuarios drop column rol, drop column google_sub, drop column apple_sub;
