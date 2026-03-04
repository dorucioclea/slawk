#!/bin/sh
set -e

# Wait for Cloud SQL proxy socket to be ready
if echo "$DATABASE_URL" | grep -q "/cloudsql/"; then
  SOCKET_DIR=$(echo "$DATABASE_URL" | sed 's/.*host=\(\/cloudsql\/[^&]*\).*/\1/')
  echo "Waiting for Cloud SQL proxy at ${SOCKET_DIR}..."
  for i in $(seq 1 30); do
    if [ -S "${SOCKET_DIR}/.s.PGSQL.5432" ]; then
      echo "Cloud SQL proxy is ready."
      break
    fi
    sleep 1
  done
fi

echo "Running database migrations..."
npx prisma migrate deploy

if [ "$RUN_SEED" = "true" ]; then
  echo "Seeding database..."
  npx tsx prisma/seed.ts
fi

echo "Starting server..."
exec node dist/index.js
