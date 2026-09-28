#!/bin/sh
set -e

echo "[entrypoint] Starting up..."

# Wait for DATABASE_URL to be available
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] DATABASE_URL is set, running migrations..."
  # A migration failure must stop the pod. It used to be swallowed by
  # `|| echo`, so an image built without src/lib/db/migrations booted
  # against an empty database, every lookup missed, and the portal served
  # the seeded demo directory -- including an admin account on the shared
  # demo password. db-migrate.mjs retries while the database comes up, so a
  # non-zero exit here means a real migration failure, not a slow start.
  node scripts/db-migrate.mjs
else
  echo "[entrypoint] DATABASE_URL not set, skipping migrations"
  echo "[entrypoint] WARNING: serving the in-code demo user directory; do not use this in production."
fi

echo "[entrypoint] Starting application..."
exec node server.js
