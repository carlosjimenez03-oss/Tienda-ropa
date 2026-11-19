# Plan: Sistema de inventario PWA para tienda de ropa y accesorios

Objetivo: PWA instalable en PC, Android, iPhone y tablet, con login (Google, Sign in with Apple y
usuario/contraseña), alta de productos con lote automático e imagen, registro de entradas y salidas
(ventas), funcionamiento sin internet y sincronización automática al recuperar la conexión.

**Cambio respecto al plan original:** el despliegue es en Dokploy como un solo paquete con la base
de datos incluida, así que Supabase se sustituyó por un servidor propio (Fastify) + PostgreSQL en el
mismo `docker-compose.yml`. Ver [ADR-001](decisiones.md#adr-001--backend-propio-en-lugar-de-supabase).
Los principios de diseño no cambian.

Leyenda: `[x]` hecho y probado · `[ ]` requiere una acción humana (cuentas, dispositivos reales, GitHub).

## 0. Supuestos

- Una tienda, 1–3 usuarias simultáneas; hasta unos miles de productos.
- Español (República Dominicana), zona horaria `America/Santo_Domingo`, moneda mostrada en RD$.
- Dominio propio con HTTPS (Dokploy + Let's Encrypt).
- Sign in with Apple requiere cuenta de Apple Developer (opcional: la app funciona sin ella).
- Impuestos y facturación electrónica: fuera de alcance.

## Fase 1 · Fundamentos

- [x] Vite + React + TypeScript, Tailwind, ESLint, Prettier.
- [x] `vite-plugin-pwa` con manifest (nombre, colores, iconos 192/512/maskable, apple-touch-icon).
- [x] `docs/decisiones.md`.
- [x] GitHub Actions: lint, tests unitarios + API (Postgres), build, E2E, build de imágenes Docker.
- [ ] Proteger la rama `main` en GitHub (Settings → Branches) — acción manual.

## Fase 2 · Backend

- [x] `server/migraciones/0001_esquema.sql`: usuarios, sesiones, productos, lotes, movimientos, imágenes.
- [x] `0002_seguridad.sql`: RLS activado en todas las tablas.
- [x] Fotos en volumen privado, servidas solo con sesión.
- [x] Tipos compartidos cliente/servidor con zod (`shared/esquemas.ts`).
- [x] Test automatizado: sin sesión no se lee ni escribe nada.

## Fase 3 · Autenticación

- [x] Correo y contraseña (bcrypt). Alta por administración (sin registro público ni SMTP).
- [x] Google (OAuth code + PKCE + verificación del id_token).
- [x] Sign in with Apple (form_post, client secret ES256, verificación del id_token).
- [ ] Configurar credenciales reales de Google y Apple — ver README §2.
- [x] MFA TOTP opcional.
- [x] Límite de intentos (10/min por IP) y bloqueo de cuenta (5 fallos → 15 min).
- [x] Sesión expirada conserva los datos pendientes; cerrar sesión pide confirmación si los hay.

## Fase 4 · Base local y dominio

- [x] Esquema Dexie versionado.
- [x] `generarCodigoLote()` + pruebas (formato, unicidad estadística, sin ambiguos).
- [x] `calcularStock()` + pruebas.
- [x] Outbox con persistencia atómica (transacción Dexie).
- [x] Alta de producto (nombre, talla, color, precio, SKU, cantidad inicial, foto) → producto + lote.
- [x] Movimientos: entrada o venta por lote; no permite vender más que el stock; anulación lógica.
- [x] Lista de productos con búsqueda por nombre/talla/color/código de lote y stock.

## Fase 5 · Imágenes

- [x] Cámara o galería.
- [x] Compresión a ≤ 1000 px, WebP 0.8 (JPEG si el navegador no codifica WebP).
- [x] Blob local visible mientras no se sube.
- [x] Subida desde la cola con reintentos, ruta `productos/{producto_id}/{id}.webp`.
- [x] Caché de fotos en el service worker (CacheFirst).

## Fase 6 · Sincronización

- [x] Push por lotes, idempotente, borra solo tras confirmación.
- [x] Backoff exponencial; errores permanentes no bloquean la cola.
- [x] Pull incremental paginado (cursor de versión global).
- [x] Productos: último gana; movimientos: sin conflicto.
- [x] Disparadores: `online`, arranque, visibilidad, cada 5 min, tras cada cambio.
- [x] Indicador "N cambios pendientes" / "Sincronizado hace X min".
- [x] `navigator.storage.persist()`.

## Fase 7 · Plataformas

- [x] Guía de instalación en iPhone/iPad; botón Instalar en Chrome/Edge/Android.
- [x] Diseño responsive (barra inferior en móvil, lateral en PC), botones grandes.
- [x] Aviso si hay cambios pendientes y más de 5 días sin sincronizar.
- [ ] Verificar instalación en dispositivos reales (Chrome PC, Android, iPhone, iPad).

## Fase 8 · Pruebas, seguridad y entrega

- [x] E2E Playwright (escritorio y móvil): login, alta offline + sync, dos dispositivos offline, foto offline.
- [x] Carga: 3000 productos y 30 000 movimientos.
- [x] Sin secretos en el bundle (comprobado en CI), CSP y cabeceras de seguridad (helmet), HSTS con HTTPS.
- [x] Backup diario de Postgres y fotos; restauración probada (`scripts/restaurar.sh`).
- [x] README: despliegue, usuarias, backups.
- [ ] Copia externa de los backups (S3 / rclone).
- [ ] Capacitación de la clienta (20 min en su dispositivo).

## Riesgos

| Riesgo                            | Mitigación                                                                |
| --------------------------------- | ------------------------------------------------------------------------- |
| Safari purga datos de PWA sin uso | Instalar la app, `storage.persist()`, aviso a los 5 días                  |
| Apple requiere cuenta paga        | Login con contraseña/Google funciona sin Apple                            |
| Errores de sincronización         | Movimientos append-only, upsert idempotente, cursor de versión, tests E2E |
| Fotos pesadas                     | WebP ≤ 1000 px, límite de 3 MB en el servidor                             |
| Lotes duplicados                  | `UNIQUE` + regeneración en el servidor                                    |
| Pérdida del servidor              | Backups diarios + copia externa (pendiente de configurar)                 |
