# syntax=docker/dockerfile:1

# This service is fully standalone (no monorepo workspace deps beyond `ws`),
# so it builds directly from this directory with npm — no pnpm workspace needed.

# --- Build stage: install all deps and compile TypeScript -------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage: production deps only ------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist ./dist

# Informational; the actual port is driven by the PORT env var (default 8080).
EXPOSE 8080

USER node
CMD ["node", "dist/index.js"]
