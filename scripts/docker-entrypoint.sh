#!/bin/sh
set -e

echo "[entrypoint] Waiting for database to be ready..."

# Wait for DATABASE_URL to be available
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] DATABASE_URL is set, running migrations..."
  node scripts/db-migrate.mjs || echo "[entrypoint] Migration failed or already applied"
else
  echo "[entrypoint] DATABASE_URL not set, skipping migrations"
fi

echo "[entrypoint] Starting application..."
exec node server.js
