import { construirApp } from './app.js';
import { leerConfig } from './config.js';
import { crearPool, migrar } from './db.js';
import { asegurarAdminInicial } from './auth/rutas.js';

async function principal() {
  const cfg = leerConfig();
  const pool = crearPool(cfg.databaseUrl);

  // Espera a que Postgres acepte conexiones (arranque en docker compose)
  for (let i = 0; ; i++) {
    try {
      await pool.query('select 1');
      break;
    } catch (e) {
      if (i >= 30) throw e;
      console.log('esperando a la base de datos…');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  await migrar(pool);
  await asegurarAdminInicial(pool, cfg, console.log);
  // Limpieza periódica de sesiones vencidas
  setInterval(
    () => pool.query('delete from sesiones where expira_en < now()').catch(() => {}),
    3_600_000,
  ).unref();

  const app = await construirApp(cfg, pool);
  await app.listen({ port: cfg.puerto, host: '0.0.0.0' });

  const cerrar = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
