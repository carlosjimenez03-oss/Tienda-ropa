# Decisiones de arquitectura

Registro breve de decisiones (ADR). Cada una: contexto → decisión → consecuencias.

## ADR-001 · Backend propio en lugar de Supabase

**Contexto.** El plan inicial usaba Supabase (Postgres + Auth + Storage). El requisito final es
desplegar en Dokploy **un único paquete que incluya la base de datos**. Supabase self-hosted son
más de 10 contenedores (Kong, GoTrue, PostgREST, Realtime, Storage, Studio…), pesado de operar para
una tienda con 1–3 usuarias.

**Decisión.** Un servidor Node/Fastify propio + PostgreSQL 16 en el mismo `docker-compose.yml`.
El servidor sirve la API, el login (contraseña y TOTP), las fotos (volumen en disco)
y la PWA compilada.

**Consecuencias.** 3 contenedores (app, db, backup). La autorización vive en la API: la base no
se expone fuera de la red interna. La RLS se activa igualmente en todas las tablas como defensa en
profundidad (un rol distinto del dueño no ve nada sin políticas). Las equivalencias con el plan:

| Plan (Supabase)             | Implementación                                                                    |
| --------------------------- | --------------------------------------------------------------------------------- |
| Supabase Auth               | `server/auth/*`: bcrypt, sesiones en Postgres (cookie httpOnly), TOTP             |
| RLS por usuario autenticado | Middleware `requerirSesion` en todas las rutas de datos + RLS activado            |
| Storage bucket privado      | Volumen `uploads`, servido solo a sesiones válidas                                |
| `auth.users`                | Tabla `usuarios`                                                                  |
| `get_advisors`              | Tests de API (acceso sin sesión, CSRF, append-only) + revisión de seguridad en CI |

## ADR-002 · Lenguaje y herramientas

TypeScript en todo el proyecto; React 19 + Vite; Tailwind 4; `vite-plugin-pwa` (Workbox);
Dexie sobre IndexedDB; Vitest + Playwright; GitHub Actions.

## ADR-003 · La UI nunca espera a la red

Toda escritura va primero a IndexedDB y a la outbox **en la misma transacción Dexie**. El motor de
sincronización trabaja en segundo plano.

## ADR-004 · IDs UUID generados en el cliente

`crypto.randomUUID()`. Dos dispositivos offline nunca chocan y los reenvíos son idempotentes.

## ADR-005 · El inventario son movimientos

Cada entrada/salida es una fila append-only; el stock es la suma. Un trigger en Postgres impide
modificar o borrar movimientos: solo se permite marcarlos como anulados (`eliminado = true`).
Dos ventas offline del mismo lote nunca se pisan.

## ADR-006 · Código de lote

Formato `AAAAMMDD-XXXX` (fecha de Santo Domingo + 4 caracteres de un alfabeto sin `0 O 1 I L`).
`UNIQUE` en Postgres. Si al sincronizar hay colisión, el servidor genera otro código y el
dispositivo lo recibe en el siguiente pull. El UUID es la clave real.

## ADR-007 · Cursor de sincronización por versión global

En lugar de comparar `actualizado_en`/`sincronizado_en` (sensibles al reloj), cada fila tiene una
columna `version` tomada de una secuencia global (`sync_version`) que se renueva en cada UPDATE por
trigger. Todas las escrituras toman un _advisory lock_ transaccional, de modo que las versiones se
confirman en orden y el pull incremental (`version > cursor`) nunca se salta filas.

## ADR-008 · Sesiones con cookie, no JWT en el navegador

Cookie `httpOnly`, `SameSite=Lax`, `Secure` con HTTPS; 90 días deslizantes (una tienda puede pasar
días sin conexión). Se guarda solo el SHA-256 del token. Protección CSRF con cabecera obligatoria
`x-inventario: 1` en toda petición que modifica datos.

## ADR-009 · Usuarios con permisos, sin registro público ni login social

Se retiró el inicio de sesión con Google y Apple a petición del cliente: solo correo y contraseña.
En lugar de roles hay cinco permisos por persona (vender, agregar mercancía, editar productos,
ver resumen, crear usuarios). Quien crea usuarios solo puede conceder los permisos que tiene; la
cuenta propietaria (única, creada desde `ADMIN_EMAIL`) tiene todos y no se puede modificar. Las
contraseñas que asigna otra persona son temporales y la app obliga a cambiarlas al entrar; mientras
tanto la API rechaza cualquier otra petición. Los permisos se comprueban en el servidor en cada
cambio sincronizado (una escritura sin permiso se marca como error permanente).

## ADR-010 · Alertas de stock y precio en cada movimiento

Cada producto guarda `stock_minimo`. Cada movimiento guarda `precio_unitario` (precio de venta en
salidas, costo en entradas), para que el resumen refleje lo realmente cobrado aunque el precio del
producto cambie después.

## Fuera de alcance (v1)

Facturación electrónica/DGII, multi-sucursal, caja y cierres, código de barras, reportes y Excel.
