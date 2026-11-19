# Inventario — tienda de ropa y accesorios

PWA instalable en PC, Android, iPhone y tablet para llevar el inventario de una tienda:
alta de productos con lote automático y foto, ventas y mercancía que llega, **aviso de
productos que se están acabando**, un **resumen** de lo vendido y lo comprado, y usuarios con
permisos. **Funciona sin internet** y se sincroniza sola al recuperar la conexión.

Todo va en **un solo paquete Docker Compose** (aplicación + PostgreSQL + copias de seguridad),
listo para desplegar en [Dokploy](https://dokploy.com).

| Pieza         | Tecnología                                                                |
| ------------- | ------------------------------------------------------------------------- |
| Interfaz      | React 19 + Vite + Tailwind CSS 4, TypeScript                              |
| PWA           | `vite-plugin-pwa` (Workbox): manifest, service worker, caché de fotos     |
| Base local    | Dexie.js sobre IndexedDB + cola _outbox_                                  |
| Servidor      | Node 22 + Fastify 5 (API, login y archivos estáticos en el mismo proceso) |
| Base de datos | PostgreSQL 16 (contenedor incluido)                                       |
| Login         | Correo y contraseña, permisos por persona, 2FA TOTP opcional              |
| Pruebas       | Vitest (unitarias + API contra Postgres real) y Playwright (E2E offline)  |

---

## 1. Desplegar en Dokploy

1. **Dominio con HTTPS.** Apunta un registro DNS (p. ej. `inventario.tu-dominio.com`) a la IP del servidor.
2. En Dokploy: **Create Project → Create Service → Compose**.
   - _Provider_: GitHub, este repositorio, rama `main`.
   - _Compose Path_: `./docker-compose.yml`.
3. Pestaña **Environment**: copia el contenido de [`.env.example`](.env.example) y rellénalo. Como mínimo:
   ```
   PUBLIC_URL=https://inventario.tu-dominio.com
   POSTGRES_PASSWORD=<clave larga aleatoria>
   ADMIN_EMAIL=<tu correo>
   ADMIN_PASSWORD=<contraseña temporal de 10+ caracteres>
   ```
4. Pestaña **Domains**: añade el dominio → servicio `app`, puerto `3000`, HTTPS activado (Let's Encrypt).
5. **Deploy.** Al arrancar, la app espera a Postgres, aplica las migraciones y crea la cuenta
   **propietaria** (todos los permisos) con `ADMIN_EMAIL`/`ADMIN_PASSWORD`, solo si la base está vacía.
6. Abre `https://inventario.tu-dominio.com` y entra con esa cuenta. La app te pedirá **crear tu
   propia contraseña** antes de continuar; la de `ADMIN_PASSWORD` deja de funcionar.

Volúmenes que crea el compose (persisten entre despliegues):

| Volumen   | Contenido                                |
| --------- | ---------------------------------------- |
| `pgdata`  | Datos de PostgreSQL                      |
| `uploads` | Fotos de productos                       |
| `backups` | Copias diarias de la base y de las fotos |

> La base de datos **no se publica** hacia internet: solo la ve la app por la red interna del compose.

### Probar el paquete en local

```bash
cp .env.example .env   # y edita PUBLIC_URL=http://localhost:3000
```

```bash
docker compose up -d --build
```

Para exponer el puerto en local añade `ports: ['3000:3000']` al servicio `app` (en Dokploy no hace falta).

---

## 2. Usuarios y permisos

- **No hay registro público** ni inicio de sesión con Google/Apple: solo correo y contraseña.
- La cuenta propietaria se crea con `ADMIN_EMAIL` / `ADMIN_PASSWORD` y tiene todos los permisos.
  No se le pueden quitar ni desactivar.
- **Ajustes → Usuarios → + Crear usuario**: correo, nombre y casillas de permisos. La app genera una
  **contraseña temporal** (p. ej. `k7mq-2xpa-rt9h`) que se muestra una sola vez para entregarla a la
  persona. Al entrar por primera vez, la app le **obliga a crear su propia contraseña**.

| Permiso                  | Qué permite                                             |
| ------------------------ | ------------------------------------------------------- |
| Vender                   | Registrar ventas y deshacerlas                          |
| Agregar mercancía        | Registrar la mercancía que llega y crear lotes nuevos   |
| Crear y editar productos | Agregar productos, cambiar precios y fotos, eliminarlos |
| Ver el resumen           | Ver cuánto se ha vendido y comprado                     |
| Crear usuarios           | Dar de alta a otras personas y darles permisos          |

Reglas (las aplica el servidor, no solo la pantalla):

- Quien tiene **Crear usuarios** solo puede dar los permisos que **él mismo tiene**, incluido el de
  crear usuarios. Así decides si alguien que creas puede crear a otros o no.
- La cuenta propietaria gestiona a todos; los demás solo a las personas que ellos crearon.
- Nadie puede cambiarse sus propios permisos.
- Desde **Gestionar** se cambian permisos, se genera una contraseña temporal nueva (obliga a
  cambiarla otra vez), se desactiva la cuenta o se quita la verificación en dos pasos.
- Cada persona puede activar la **verificación en dos pasos** en _Ajustes → Seguridad_
  (Google Authenticator, Microsoft Authenticator, 1Password…).

Protecciones del login: máximo 10 intentos por minuto por IP (`LOGIN_RATE_LIMIT`) y bloqueo de la
cuenta 15 minutos tras 5 contraseñas incorrectas seguidas.

### Avisos de productos por acabarse

Cada producto tiene un campo **"Avisarme cuando queden N unidades o menos"** (2 por defecto). Cuando
el stock llega a ese número:

- aparece en **Inicio** con un botón **Reponer**, con un contador en el menú;
- se marca **⚠️ Quedan pocos** o **🚫 Agotado** en la lista de productos (filtro _Por reponer_);
- al registrar la venta se muestra el aviso y, si se activaron en _Ajustes → Avisos_, llega una
  **notificación** al teléfono o la PC (en iPhone/iPad requiere la app instalada, iOS 16.4+).

### Resumen (panel)

En **Inicio**, quien tenga el permiso _Ver el resumen_ ve, para hoy / 7 días / este mes / 30 días:
lo **vendido** (RD$ y unidades), lo **comprado** (mercancía que llegó, con su costo si se anotó), las
unidades y el valor del inventario, las ventas por día, lo más vendido y los últimos movimientos.
Cada venta guarda el precio al que se vendió (se puede cambiar si hubo descuento) y cada entrada
puede guardar su costo.

---

## 3. Copias de seguridad

El servicio `backup` hace una copia **al arrancar y luego cada día** a la hora `BACKUP_HOUR`
(hora de Santo Domingo) y conserva `BACKUP_KEEP_DAYS` días (14 por defecto):

- `db-AAAAMMDD-HHMMSS.dump` — base de datos (`pg_dump` formato _custom_).
- `fotos-AAAAMMDD-HHMMSS.tar.gz` — fotos de productos.

Comandos (en el servidor, dentro de la carpeta del compose; en Dokploy suele ser
`/etc/dokploy/compose/<nombre>/code`):

```bash
docker compose exec backup sh /backup.sh ahora
```

```bash
docker compose exec backup ls -lh /backups
```

**Restaurar** (detiene la app, reemplaza los datos y la vuelve a arrancar):

```bash
sh scripts/restaurar.sh db-20260101-030000.dump fotos-20260101-030000.tar.gz
```

**Recomendado:** copiar también las copias fuera del servidor (p. ej. con la función de _Volume Backups_
de Dokploy hacia S3, o con `rclone` desde el volumen `backups`). Una copia en el mismo disco no protege
de la pérdida del servidor.

---

## 4. Instalar la app en cada dispositivo

| Dispositivo            | Cómo                                                                            |
| ---------------------- | ------------------------------------------------------------------------------- |
| PC (Chrome / Edge)     | Icono de instalar en la barra de direcciones, o el botón **Instalar** de la app |
| Android (Chrome)       | Botón **Instalar** de la app, o menú ⋮ → _Instalar aplicación_                  |
| iPhone / iPad (Safari) | **Compartir → Añadir a pantalla de inicio** (la app muestra la guía)            |

En iPhone/iPad es importante instalarla: Safari puede borrar los datos de las webs que no se usan en
varios días. La app pide almacenamiento persistente y avisa si lleva más de 5 días sin sincronizar
con cambios pendientes.

---

## 5. Uso sin internet

- Todo cambio se guarda primero en el dispositivo (IndexedDB) y en una cola de cambios pendientes.
- La barra superior indica _"Sin conexión · N cambios pendientes"_ o _"Sincronizado hace X min"_;
  tocándola se fuerza una sincronización.
- Se sincroniza al recuperar la conexión, al abrir la app, al volver a ella y cada 5 minutos.
- Si la sesión expira, los cambios pendientes **no se pierden**: se suben al volver a entrar.
- Cerrar sesión con cambios pendientes pide confirmación y los conserva en el dispositivo.

Detalles técnicos en [`docs/sincronizacion.md`](docs/sincronizacion.md) y decisiones en
[`docs/decisiones.md`](docs/decisiones.md).

---

## 6. Desarrollo

Requisitos: Node 22 y PostgreSQL 16 (o Docker).

```bash
npm install
```

```bash
DATABASE_URL=postgres://postgres@localhost:5432/inventario ADMIN_EMAIL=admin@tienda.test ADMIN_PASSWORD=contrasena-segura-1 npm run dev
```

La interfaz queda en `http://localhost:5173` (Vite reenvía `/api` al servidor en el puerto 3000).

| Comando                           | Qué hace                                                           |
| --------------------------------- | ------------------------------------------------------------------ |
| `npm run lint`                    | ESLint + Prettier                                                  |
| `npm test`                        | Unitarias; las de API se ejecutan si existe `TEST_DATABASE_URL`    |
| `npm run build`                   | Compila interfaz (`dist/`) y servidor (`dist-server/`)             |
| `npm start`                       | Arranca el servidor compilado (sirve API + PWA)                    |
| `npm run test:e2e`                | Playwright contra `BASE_URL` (por defecto `http://localhost:3000`) |
| `node scripts/generar-iconos.mjs` | Regenera los PNG de iconos desde los SVG                           |

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/inventario_test npm test
```

Para E2E, arranca el servidor con `LOGIN_RATE_LIMIT=1000` (las pruebas inician sesión muchas veces).

### Estructura

```
server/               API Fastify: auth/, sync.ts, imagenes.ts, migraciones/*.sql
shared/               Código común cliente/servidor: lote, stock, esquemas (zod)
src/
  auth/               Login y sesión (offline-first)
  db/                 Esquema Dexie y outbox
  sync/               push, pull y motor de sincronización
  dominio/            Operaciones (alta, lotes, ventas), validaciones, consultas
  imagenes/           Compresión a WebP ≤ 1000 px
  componentes/, pantallas/
tests/unit, tests/server, tests/e2e
docker-compose.yml    app + db + backup
```
