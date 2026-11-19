#!/bin/sh
# Restaura una copia de la base de datos (y opcionalmente las fotos).
# Ejecutar en el servidor, en la carpeta del docker-compose:
#   sh scripts/restaurar.sh db-20260101-030000.dump [fotos-20260101-030000.tar.gz]
# Para ver las copias disponibles:
#   docker compose exec backup ls -lh /backups
# ATENCIÓN: reemplaza los datos actuales.
set -eu
DUMP=${1:?Indica el archivo db-*.dump (dentro del volumen de backups)}
FOTOS=${2:-}

echo "Deteniendo la app…"
docker compose stop app
echo "Restaurando base de datos desde $DUMP…"
docker compose exec -T backup sh -c "pg_restore --clean --if-exists --no-owner -d \"\$PGDATABASE\" /backups/$DUMP"
if [ -n "$FOTOS" ]; then
  echo "Restaurando fotos desde $FOTOS…"
  docker compose exec -T backup cat "/backups/$FOTOS" |
    docker compose run --rm --no-deps -T --user root --entrypoint sh app -c "tar -xzf - -C /data && chown -R node:node /data/uploads"
fi
docker compose start app
echo "Restauración completada."
