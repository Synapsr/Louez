#!/bin/sh
set -e

echo "==================================="
echo "  Louez - Container Startup"
echo "==================================="
echo ""

# Run database migrations
echo "Checking database migrations..."
node docker/migrate.mjs

echo ""
echo "Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
