# syntax=docker/dockerfile:1

# =============================================================================
# Louez - Production Dockerfile
# =============================================================================
# Optimized multi-stage build for Next.js standalone output
# Image size: ~150MB | Startup: <5s | Non-root user
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

# Enable pnpm and build
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

# Switch to non-root user
USER nextjs

# Expose application port
EXPOSE 3000

# Health check for container orchestrators (EasyPanel, Dokploy, Kubernetes)
# - start-period: 60s to allow Next.js to fully initialize
# - interval: 30s between checks
# - timeout: 10s for each check
# - retries: 3 failures before unhealthy
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start Next.js server
CMD ["node", "server.js"]
