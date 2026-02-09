# syntax=docker/dockerfile:1
#
# DEPRECATED: Use docker/Dockerfile.web instead
#
# This file exists for backward compatibility only.
# For Turborepo-native builds, use:
#   docker build -f docker/Dockerfile.web -t louez-web .
#
# =============================================================================

# Include the web app Dockerfile
# Note: Docker doesn't support includes, so this is a copy for compatibility
# The canonical version is in docker/Dockerfile.web

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/validations/package.json ./packages/validations/
COPY packages/db/package.json ./packages/db/
COPY packages/ui/package.json ./packages/ui/
COPY packages/email/package.json ./packages/email/
COPY packages/pdf/package.json ./packages/pdf/
COPY apps/web/package.json ./apps/web/
RUN corepack enable pnpm && pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /app/packages/utils/node_modules ./packages/utils/node_modules
COPY --from=deps /app/packages/validations/node_modules ./packages/validations/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules
COPY --from=deps /app/packages/email/node_modules ./packages/email/node_modules
COPY --from=deps /app/packages/pdf/node_modules ./packages/pdf/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1
RUN corepack enable pnpm && pnpm turbo run build --filter=@louez/web

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/docker/migrate.mjs ./docker/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/src/migrations ./migrations
# Copy node_modules required by migrate.mjs (not included in standalone output)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/mysql2 ./node_modules/mysql2
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD sh -c "wget --no-verbose --tries=1 --spider http://localhost:\${PORT:-3000}/api/health || exit 1"
ENTRYPOINT ["./docker/entrypoint.sh"]
