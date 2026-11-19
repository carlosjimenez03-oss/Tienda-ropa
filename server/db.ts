import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// numeric -> number (precios caben de sobra en un double)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// bigint -> number (versiones de sincronización)
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// timestamptz -> ISO string, para no perder el formato entre cliente y servidor
pg.types.setTypeParser(1184, (v) => (v === null ? null : new Date(v).toISOString()));

export type Pool = pg.Pool;
export type Cliente = pg.PoolClient;

export function crearPool(url: string): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 10 });
}

export async function migrar(pool: pg.Pool, log: (m: string) => void = console.log): Promise<void> {
  const dir = await resolverDirMigraciones();
  const cliente = await pool.connect();
  try {
    await cliente.query('select pg_advisory_lock(727001)');
    await cliente.query(
      'create table if not exists schema_migraciones (nombre text primary key, aplicada_en timestamptz not null default now())',
    );
    const { rows } = await cliente.query<{ nombre: string }>(
      'select nombre from schema_migraciones',
    );
    const hechas = new Set(rows.map((r) => r.nombre));
    const archivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const archivo of archivos) {
      if (hechas.has(archivo)) continue;
      const sql = await readFile(path.join(dir, archivo), 'utf8');
      await cliente.query('begin');
      try {
        await cliente.query(sql);
        await cliente.query('insert into schema_migraciones (nombre) values ($1)', [archivo]);
        await cliente.query('commit');
        log(`migración aplicada: ${archivo}`);
      } catch (e) {
        await cliente.query('rollback');
        throw new Error(`Falló la migración ${archivo}: ${(e as Error).message}`);
      }
    }
  } finally {
    await cliente.query('select pg_advisory_unlock(727001)').catch(() => {});
    cliente.release();
  }
}

async function resolverDirMigraciones(): Promise<string> {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const candidatos = [
    process.env.MIGRATIONS_DIR,
    path.resolve(aqui, 'migraciones'),
    path.resolve(aqui, '../../server/migraciones'),
  ].filter(Boolean) as string[];
  for (const c of candidatos) {
    try {
      await readdir(c);
      return c;
    } catch {
      /* siguiente */
    }
  }
  throw new Error('No se encontró el directorio de migraciones');
}
