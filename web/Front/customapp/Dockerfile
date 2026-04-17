# syntax=docker/dockerfile:1
# ── Vite build + nginx serve ─────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY vendor ./vendor
# NeoLibrary lives in /deign on the dev laptop; in the build context it lives
# in ./vendor. Rewrite the package.json path + drop the stale lock entry so
# `npm install` (not ci) picks up the vendored tarball.
RUN sed -i 's|file:\.\./\.\./\.\./deign/|file:./vendor/|g' package.json package-lock.json || true
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY . .
# Prod config.json is injected at runtime via the web container's volume or
# rewritten by nginx — we build a static bundle with no baked-in backend URL.
# Override Vite base path for the root-served prod deployment.
ENV VITE_BASE=/
RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.prod.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Overwrite the dev config.json so the SPA hits same-origin /api behind Caddy.
RUN printf '{"GLB_API_URL":"","GLB_ELISE_URL":""}\n' > /usr/share/nginx/html/config.json
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1
