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
# Swap the Postgres schema in before generating the client — local dev keeps
# schema.prisma (MariaDB), prod uses schema.postgres.prisma.
RUN cp prisma/schema.postgres.prisma prisma/schema.prisma
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Production runtime: drop the mariadb adapter — Prisma connects directly with
# the datasource url (Postgres native driver via Prisma engine).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
RUN mkdir -p uploads logs
EXPOSE 3000
# Apply schema on first start (idempotent for subsequent restarts), then boot.
CMD ["sh", "-c", "npx prisma db push --accept-data-loss --url \"$DATABASE_URL\" && node dist/src/main.js"]
