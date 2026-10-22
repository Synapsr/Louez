# syntax=docker/dockerfile:1
# Build from the MONOREPO ROOT:
# docker build -f apps/voice-relay/Dockerfile -t louez-voice-relay .
FROM node:22.23.4-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/voice/package.json ./packages/voice/
COPY apps/voice-relay/package.json ./apps/voice-relay/
RUN pnpm install --frozen-lockfile --filter @louez/voice-relay...
COPY packages/voice ./packages/voice
COPY apps/voice-relay ./apps/voice-relay
RUN pnpm --filter @louez/voice build && pnpm --filter @louez/voice-relay build
RUN pnpm --filter @louez/voice-relay bundle

FROM node:22.23.4-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/apps/voice-relay/dist/server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
