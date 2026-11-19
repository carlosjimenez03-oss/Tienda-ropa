import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseLocal, usarBase, db } from '../../src/db/local';
import {
  anularMovimiento,
  crearLote,
  crearProducto,
  registrarMovimiento,
  stockDeLote,
  actualizarProducto,
} from '../../src/dominio/operaciones';
import { aplicarPull } from '../../src/sync/pull';
import { push } from '../../src/sync/push';
import { cargarProductos, filtrar } from '../../src/dominio/consultas';
import { backoff } from '../../src/db/outbox';
import { validarProducto } from '../../src/dominio/validaciones';
import { dimensionesEscaladas } from '../../src/imagenes/comprimir';

let n = 0;
beforeEach(async () => {
  usarBase(new BaseLocal(`prueba-${n++}`));
  vi.unstubAllGlobals();
});

describe('operaciones offline', () => {
  it('crear producto genera producto + lote + entrada y los encola', async () => {
    const { producto, lote } = await crearProducto({
      nombre: ' Vestido rojo ',
      precio: 1500,
      cantidadInicial: 5,
    });
    expect(producto.nombre).toBe('Vestido rojo');
    expect(lote.codigo).toMatch(/^\d{8}-[A-Z2-9]{4}$/);
    expect(await stockDeLote(lote.id)).toBe(5);
    const outbox = await db.outbox.orderBy('id').toArray();
    expect(outbox.map((o) => `${o.tabla}.${o.operacion}`)).toEqual([
      'productos.upsert',
      'lotes.insertar',
      'movimientos.insertar',
    ]);
  });

  it('no permite vender más que el stock', async () => {
    const { lote } = await crearProducto({ nombre: 'Collar', cantidadInicial: 2 });
    await registrarMovimiento({ loteId: lote.id, tipo: 'salida', cantidad: 2 });
    await expect(
      registrarMovimiento({ loteId: lote.id, tipo: 'salida', cantidad: 1 }),
    ).rejects.toThrow(/stock/);
    expect(await stockDeLote(lote.id)).toBe(0);
  });

  it('la operación es atómica: si falla no queda nada en la outbox', async () => {
    const { lote } = await crearProducto({ nombre: 'Collar', cantidadInicial: 1 });
    const antes = await db.outbox.count();
    await expect(
      registrarMovimiento({ loteId: lote.id, tipo: 'salida', cantidad: 5 }),
    ).rejects.toThrow();
    expect(await db.outbox.count()).toBe(antes);
  });

  it('anular una venta devuelve el stock', async () => {
    const { lote } = await crearProducto({ nombre: 'Gorra', cantidadInicial: 3 });
    const venta = await registrarMovimiento({ loteId: lote.id, tipo: 'salida', cantidad: 2 });
    await anularMovimiento(venta.id);
    expect(await stockDeLote(lote.id)).toBe(3);
    const ultimo = await db.outbox.orderBy('id').last();
    expect(ultimo).toMatchObject({
      tabla: 'movimientos',
      operacion: 'anular',
      payload: { id: venta.id },
    });
  });

  it('nuevo lote de un producto existente', async () => {
    const { producto } = await crearProducto({ nombre: 'Jean', cantidadInicial: 1 });
    const lote2 = await crearLote(producto.id, 4);
    const filas = await cargarProductos();
    expect(filas[0].stock).toBe(5);
    expect(filtrar(filas, lote2.codigo)).toHaveLength(1);
    expect(filtrar(filas, 'jean')).toHaveLength(1);
    expect(filtrar(filas, 'camisa')).toHaveLength(0);
  });

  it('valida los datos del producto', () => {
    expect(() => validarProducto({ nombre: '   ' })).toThrow(/obligatorio/);
    expect(() => validarProducto({ nombre: 'x', precio: -1 })).toThrow(/negativo/);
    expect(validarProducto({ nombre: 'x', precio: 10.555 }).precio).toBe(10.56);
  });
});

describe('sincronización', () => {
  it('pull aplica "último gana" en productos', async () => {
    const { producto } = await crearProducto({ nombre: 'Local', cantidadInicial: 0 });
    await actualizarProducto(producto.id, { nombre: 'Local editado' });
    const local = await db.productos.get(producto.id);
    await aplicarPull({
      productos: [
        { ...producto, nombre: 'Servidor viejo', actualizado_en: '2000-01-01T00:00:00.000Z' },
      ],
      lotes: [],
      movimientos: [],
      imagenes: [],
      cursor: 10,
      hayMas: false,
    });
    expect((await db.productos.get(producto.id))!.nombre).toBe('Local editado');
    await aplicarPull({
      productos: [
        { ...local!, nombre: 'Servidor nuevo', actualizado_en: '2999-01-01T00:00:00.000Z' },
      ],
      lotes: [],
      movimientos: [],
      imagenes: [],
      cursor: 11,
      hayMas: false,
    });
    expect((await db.productos.get(producto.id))!.nombre).toBe('Servidor nuevo');
    expect((await db.meta.get('ultimo_pull'))!.valor).toBe(11);
  });

  it('pull no deshace una anulación local pendiente', async () => {
    const { lote } = await crearProducto({ nombre: 'Aretes', cantidadInicial: 5 });
    const venta = await registrarMovimiento({ loteId: lote.id, tipo: 'salida', cantidad: 1 });
    await anularMovimiento(venta.id);
    await aplicarPull({
      productos: [],
      lotes: [],
      movimientos: [{ ...venta, eliminado: false }],
      imagenes: [],
      cursor: 1,
      hayMas: false,
    });
    expect((await db.movimientos.get(venta.id))!.eliminado).toBe(true);
  });

  it('push borra lo confirmado, marca errores permanentes y pospone reintentos', async () => {
    await crearProducto({ nombre: 'Blusa', cantidadInicial: 2 });
    const items = await db.outbox.orderBy('id').toArray();
    const fetchFalso = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            resultados: [
              { id: items[0].id, estado: 'ok' },
              { id: items[1].id, estado: 'permanente', mensaje: 'malo' },
              { id: items[2].id, estado: 'reintentar', mensaje: 'luego' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchFalso);
    expect(await push()).toBe(1);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const resto = await db.outbox.orderBy('id').toArray();
    expect(resto).toHaveLength(2);
    expect(resto[0]).toMatchObject({ estado: 'error', error: 'malo' });
    expect(resto[1]).toMatchObject({ estado: 'pendiente', intentos: 1 });
    expect(resto[1].proximo_intento).toBeGreaterThan(Date.now());
  });

  it('push sin red lanza y conserva la outbox', async () => {
    await crearProducto({ nombre: 'Blusa', cantidadInicial: 1 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(push()).rejects.toThrow(/conexión/);
    expect(await db.outbox.count()).toBe(3);
  });

  it('backoff exponencial con tope', () => {
    expect(backoff(1)).toBe(5000);
    expect(backoff(2)).toBe(10000);
    expect(backoff(30)).toBe(15 * 60_000);
  });
});

describe('imágenes', () => {
  it('escala al lado mayor de 1000 px', () => {
    expect(dimensionesEscaladas(4000, 3000)).toEqual({ ancho: 1000, alto: 750 });
    expect(dimensionesEscaladas(600, 800)).toEqual({ ancho: 600, alto: 800 });
    expect(dimensionesEscaladas(1500, 3000)).toEqual({ ancho: 500, alto: 1000 });
  });
});

describe('rendimiento', () => {
  it('3000 productos y 30000 movimientos: carga y búsqueda rápidas', async () => {
    const ahora = new Date().toISOString();
    const productos = [];
    const lotes = [];
    const movimientos = [];
    for (let i = 0; i < 3000; i++) {
      const pid = crypto.randomUUID();
      const lid = crypto.randomUUID();
      productos.push({
        id: pid,
        nombre: `Producto ${i} ${i % 7 === 0 ? 'vestido' : 'blusa'}`,
        creado_en: ahora,
        actualizado_en: ahora,
        eliminado: false,
      });
      lotes.push({
        id: lid,
        codigo: `20260101-${String(i).padStart(4, 'A')}`,
        producto_id: pid,
        creado_en: ahora,
      });
      for (let j = 0; j < 10; j++) {
        movimientos.push({
          id: crypto.randomUUID(),
          lote_id: lid,
          tipo: j === 0 ? 'entrada' : 'salida',
          cantidad: j === 0 ? 20 : 1,
          ocurrido_en: ahora,
          eliminado: false,
        } as const);
      }
    }
    await db.productos.bulkAdd(productos);
    await db.lotes.bulkAdd(lotes);
    await db.movimientos.bulkAdd(movimientos);

    const t0 = performance.now();
    const filas = await cargarProductos();
    const t1 = performance.now();
    const r = filtrar(filas, 'vestido');
    const t2 = performance.now();
    expect(filas).toHaveLength(3000);
    expect(filas[0].stock).toBe(11);
    expect(r.length).toBe(429);
    // fake-indexeddb es bastante más lento que IndexedDB real; márgenes holgados
    expect(t1 - t0).toBeLessThan(5000);
    expect(t2 - t1).toBeLessThan(50);
  }, 60_000);
});
