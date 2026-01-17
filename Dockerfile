# syntax=docker/dockerfile:1

# =============================================================================
# Louez - Production Dockerfile
# =============================================================================
# Optimized multi-stage build for Next.js standalone output
# Image size: ~150MB | Startup: <5s | Non-root user
#
# Features:
# - Automatic database migrations at container startup
# - Health checks for container orchestrators
# - Non-root user for security
#
# Build:  docker build -t louez .
# Run:    docker run -p 3000:3000 --env-file .env louez
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# Install all npm dependencies in isolated stage for better caching
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

# libc6-compat is needed for some npm packages on Alpine
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy only package files for dependency caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies using pnpm
RUN corepack enable pnpm && \
    pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: Builder
# Build the Next.js application with standalone output
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the application
RUN corepack enable pnpm && pnpm build

# -----------------------------------------------------------------------------
# Stage 3: Runner (Production)
# Minimal image with only the standalone build output
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Install wget for health checks and create non-root user
RUN apk add --no-cache wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy public assets (static files)
COPY --from=builder /app/public ./public

# Copy standalone build (includes server.js and minimal node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy database migration script and SQL files
COPY --from=builder --chown=nextjs:nodejs /app/docker/migrate.mjs ./docker/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db/migrations ./migrations

# Copy and prepare entrypoint script
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh

# Switch to non-root user
USER nextjs

# Expose application port
EXPOSE 3000

# Health check for container orchestrators (EasyPanel, Dokploy, Kubernetes)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD sh -c "wget --no-verbose --tries=1 --spider http://localhost:\${PORT:-3000}/api/health || exit 1"

# Start with entrypoint (runs migrations then starts server)
ENTRYPOINT ["./docker/entrypoint.sh"]
