#!/bin/sh
# Veritabanı testleri dahil tüm API testlerini çalıştırır.
# Geçici bir PostgreSQL 17 container'ı açar, testlerden sonra siler. Docker gerekir.
# Kendi PostgreSQL'iniz varsa bunun yerine: TEST_DATABASE_URL=postgres://... npm test
set -eu

PORT="${TEST_DB_PORT:-55432}"
NAME="kunye-test-db-$$"

docker run -d --rm --name "$NAME" -p "127.0.0.1:$PORT:5432" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kunye_test postgres:17-alpine >/dev/null
trap 'docker stop "$NAME" >/dev/null 2>&1 || true' EXIT INT TERM

printf "PostgreSQL bekleniyor"
i=0
until docker exec "$NAME" pg_isready -U postgres -d kunye_test >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then echo " zaman aşımı"; exit 1; fi
  printf "."
  sleep 1
done
echo " hazır"

TEST_DATABASE_URL="postgres://postgres:test@127.0.0.1:$PORT/kunye_test" npx vitest run
