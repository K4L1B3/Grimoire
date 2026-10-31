#!/bin/sh
# pnpm backup (SDD §8): dump do banco + arquivos enviados, num .tar.gz em backups/.
# Restaurar: veja "Backup" no README.
set -eu
cd "$(dirname "$0")/.."
# Lê só UPLOAD_DIR do .env (sem "source": valores com espaço quebrariam o shell).
env_upload=$( [ -f .env ] && grep -E '^UPLOAD_DIR=' .env | cut -d= -f2- | tr -d '"' || true)

stamp=$(date +%Y%m%d-%H%M%S)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p backups

docker compose exec -T postgres pg_dump -U grimorio -Fc grimorio > "$tmp/banco.dump"

# Arquivos: dados do MinIO (se estiver rodando) e/ou a pasta local de uploads.
if [ -n "$(docker compose ps -q --status running minio 2>/dev/null)" ]; then
  docker compose cp minio:/data "$tmp/minio"
fi
uploads=${UPLOAD_DIR:-${env_upload:-data/uploads}}
if [ -d "$uploads" ]; then cp -R "$uploads" "$tmp/uploads"; fi

tar -czf "backups/grimorio-$stamp.tar.gz" -C "$tmp" .
echo "backups/grimorio-$stamp.tar.gz"
