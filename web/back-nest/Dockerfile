# syntax=docker/dockerfile:1
# ── Multi-stage NestJS build for Postgres prod ───────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# schema.prisma is canonical Postgres now (MySQL/MariaDB support removed).
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Create a non-root user. RCE inside the container (e.g. via ffmpeg in the
# audio path, or any future native dep) lands as `node` instead of root —
# defence in depth that matches the Python transcription container.
RUN addgroup -S node-app && adduser -S -G node-app node-app
# su-exec lets the entrypoint drop from root to node-app after a one-time chown.
RUN apk add --no-cache su-exec

COPY --from=build --chown=node-app:node-app /app/node_modules ./node_modules
COPY --from=build --chown=node-app:node-app /app/dist ./dist
COPY --from=build --chown=node-app:node-app /app/prisma ./prisma
COPY --from=build --chown=node-app:node-app /app/package.json ./package.json
COPY --from=build --chown=node-app:node-app /app/prisma.config.ts ./prisma.config.ts
RUN mkdir -p uploads logs && chown -R node-app:node-app uploads logs

EXPOSE 3000
# The container starts as root ONLY to fix ownership of the mounted uploads/logs
# volumes (Docker named volumes mount as root and override the image's chown,
# which broke meeting-audio mkdir with EACCES), then immediately drops to the
# non-root node-app user via su-exec for the actual server process. So the
# app still runs unprivileged — only the boot-time chown runs as root.
# Migrations run as node-app (DB creds, no fs needs). `migrate deploy` is
# non-destructive (versioned migrations only).
CMD ["sh", "-c", "chown -R node-app:node-app /app/uploads /app/logs 2>/dev/null || true; exec su-exec node-app sh -c 'npx prisma migrate deploy && node dist/src/main.js'"]
