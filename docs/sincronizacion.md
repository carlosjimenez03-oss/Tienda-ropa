# Sincronización offline

```
 Dispositivo                                           Servidor (Fastify + Postgres)
┌──────────────────────────────────┐
│ Pantalla                         │
│   │ crearProducto / venta        │
│   ▼  (transacción Dexie)         │
│ IndexedDB: productos, lotes,     │
│   movimientos, imagenes          │
│ + outbox (cambios pendientes)    │
│ + imagenes_locales (blobs WebP)  │
└──────────┬───────────────────────┘
           │ push: POST /api/sync/push (lotes de 100)  ─────►  upsert idempotente por UUID
           │       PUT  /api/imagenes/:id (una a una)   ─────►  archivo en /data/uploads
           │                                                    (todo bajo advisory lock)
           │ pull: GET /api/sync/pull?desde=<cursor>   ◄─────   filas con version > cursor
           ▼                                                    (paginado, ordenado)
     meta.ultimo_pull = cursor
```

## Push

1. Se toman de la outbox los elementos `pendiente` cuyo `proximo_intento` ya pasó, en orden de creación.
2. Los datos se envían en lotes de hasta 100; el servidor aplica cada cambio dentro de un _savepoint_
   y responde por elemento:
   - `ok` → se borra de la outbox.
   - `permanente` (validación fallida) → se marca `error`; **no bloquea** al resto. Se ve en
     _Ajustes → Sincronización_ con opciones Reintentar/Descartar.
   - `reintentar` (p. ej. el lote llega antes que su producto) → `intentos + 1` y backoff
     exponencial (5 s, 10 s, 20 s… máx. 15 min). Tras 25 intentos pasa a `error`.
3. Las fotos se suben con `PUT /api/imagenes/:id?producto_id=…`. Tras confirmarse se guardan en la
   caché del service worker con su URL remota y se borra el blob local.

Idempotencia: reenviar el mismo cambio (mismo UUID) no duplica nada (`on conflict (id) do nothing`
para lotes/movimientos; _último gana_ para productos).

## Pull

`GET /api/sync/pull?desde=N&limite=1000` devuelve filas de las 4 tablas con `version > N`, mezcladas
en orden de versión, y el nuevo `cursor`. Se repite mientras `hayMas`.

Al aplicar:

- **Productos:** último gana por `actualizado_en`; si la copia local es más nueva, se conserva
  (su upsert pendiente ganará en el servidor).
- **Lotes:** se sobrescriben (el servidor puede haber cambiado el código por colisión).
- **Movimientos:** son inserts, nunca hay conflicto. La anulación es monotónica:
  `eliminado = servidor || local`.
- **Imágenes:** se registran; el archivo lo descarga el navegador y lo cachea el service worker.

## Disparadores

- Evento `online` del navegador.
- Arranque de la app (tras validar la sesión).
- La pestaña vuelve a estar visible.
- Cada 5 minutos con la app abierta.
- ~1 s después de cada cambio local.
- Tocando la barra de estado o _Sincronizar ahora_.

Sin red se reintenta con backoff exponencial. Un 401 marca la sesión como expirada: se muestra la
pantalla de login **sin tocar** los datos locales; al volver a entrar la outbox se sube.

## Garantía con dos dispositivos offline

Dispositivo A vende 3 y dispositivo B vende 4 del mismo lote (stock 10) sin conexión. Al reconectar,
cada uno sube su movimiento (UUID distinto) y descarga el del otro: stock final 3 en servidor y en
ambos dispositivos. Cubierto por `tests/server/api.test.ts` y `tests/e2e/offline.spec.ts`.

> Como cada dispositivo valida el stock solo con lo que conoce, dos ventas offline simultáneas pueden
> dejar el stock en negativo si entre ambas superan lo disponible. El servidor lo acepta (las ventas
> ocurrieron) y la lista lo muestra para que se corrija con una entrada.
