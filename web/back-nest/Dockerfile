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

COPY --from=build --chown=node-app:node-app /app/node_modules ./node_modules
COPY --from=build --chown=node-app:node-app /app/dist ./dist
COPY --from=build --chown=node-app:node-app /app/prisma ./prisma
COPY --from=build --chown=node-app:node-app /app/package.json ./package.json
COPY --from=build --chown=node-app:node-app /app/prisma.config.ts ./prisma.config.ts
RUN mkdir -p uploads logs && chown -R node-app:node-app uploads logs

USER node-app

EXPOSE 3000
# Apply pending migrations (non-destructive) on boot, then start the server.
# Use `prisma migrate deploy` instead of `db push --accept-data-loss` to
# preserve data and only apply versioned migrations.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
