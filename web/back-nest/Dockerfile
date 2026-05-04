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
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
RUN mkdir -p uploads logs
EXPOSE 3000
# Apply pending migrations (non-destructive) on boot, then start the server.
# Use `prisma migrate deploy` instead of `db push --accept-data-loss` to
# preserve data and only apply versioned migrations.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
