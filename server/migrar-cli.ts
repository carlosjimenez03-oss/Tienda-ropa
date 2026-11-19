import { leerConfig } from './config.js';
import { crearPool, migrar } from './db.js';

const pool = crearPool(leerConfig().databaseUrl);
migrar(pool)
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
