#!/bin/sh
# Bucle de copias de seguridad: una vez al día a la hora BACKUP_HOUR (hora local).
# Uso manual dentro del contenedor:  sh /backup.sh ahora
set -eu

DESTINO=/backups
DIAS="${BACKUP_KEEP_DAYS:-14}"

copia() {
  marca=$(date +%Y%m%d-%H%M%S)
  mkdir -p "$DESTINO"
  pg_dump --format=custom --no-owner --file="$DESTINO/db-$marca.dump.tmp"
  mv "$DESTINO/db-$marca.dump.tmp" "$DESTINO/db-$marca.dump"
  if [ -d /data/uploads ]; then
    tar -czf "$DESTINO/fotos-$marca.tar.gz.tmp" -C /data uploads
    mv "$DESTINO/fotos-$marca.tar.gz.tmp" "$DESTINO/fotos-$marca.tar.gz"
  fi
  # Rotación: se eliminan copias más antiguas que BACKUP_KEEP_DAYS
  find /backups -maxdepth 1 -type f -name 'db-*.dump' -mtime "+$DIAS" -exec rm -f {} \;
  find /backups -maxdepth 1 -type f -name 'fotos-*.tar.gz' -mtime "+$DIAS" -exec rm -f {} \;
  echo "$(date) copia creada: db-$marca.dump"
}

if [ "${1:-}" = "ahora" ]; then
  copia
  exit 0
fi

echo "Servicio de copias iniciado (diaria a las ${BACKUP_HOUR:-3}:00, se conservan $DIAS días)"
# Una copia al arrancar para tener siempre al menos una
sleep 20
copia || echo "falló la copia inicial"
ultima=$(date +%Y%m%d)
while true; do
  sleep 300
  hoy=$(date +%Y%m%d)
  hora=$(date +%H | sed 's/^0//')
  if [ "$hoy" != "$ultima" ] && [ "${hora:-0}" -ge "${BACKUP_HOUR:-3}" ]; then
    copia || echo "falló la copia"
    ultima=$hoy
  fi
done
