#!/bin/sh
set -eu

# Managed platforms publish the database URL and the app's public URL under
# their own variable names. Adopt them when the operator set nothing, so the
# one-click deployments in deploy/ boot without a manual configuration pass.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${JAWSDB_URL:-}" ]; then
  DATABASE_URL="$JAWSDB_URL"
  export DATABASE_URL
fi

if [ -z "${AUTH_URL:-}" ] && [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  AUTH_URL="$RENDER_EXTERNAL_URL"
  export AUTH_URL
fi

# Zero-config secret for standalone installs: when the operator provides no
# AUTH_SECRET, generate one once and persist it under /app/data (mounted as a
# volume by docker-compose.yml) so sessions survive container recreation.
# Deployments that set AUTH_SECRET (the cloud, multi-replica installs) never
# enter this branch.
if [ -z "${AUTH_SECRET:-}" ]; then
  secret_file="/app/data/auth-secret"
  if [ ! -f "$secret_file" ]; then
    mkdir -p /app/data
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > "$secret_file"
    chmod 600 "$secret_file"
  fi
  AUTH_SECRET="$(cat "$secret_file")"
  export AUTH_SECRET
fi

# Keep better-auth's alternate variable name aligned when only one is set.
: "${BETTER_AUTH_SECRET:=$AUTH_SECRET}"
export BETTER_AUTH_SECRET

exec "$@"
