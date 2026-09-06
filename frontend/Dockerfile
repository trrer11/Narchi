# syntax=docker/dockerfile:1.7
# =============================================================================
# NARCHI V5 — Frontend production image
# Node 22 is required by That Open Engine / camera-controls 3.x.
# The build ships web-ifc WASM and the Fragments worker locally: no CDN runtime.
# =============================================================================

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
  && test -s dist/ifc/web-ifc.wasm \
  && test -s dist/ifc/web-ifc-api.js \
  && test -s dist/ifc/fragments-worker.mjs \
  && test -s dist/vendor/three.module-0.185.1-narchi-v2.js \
  && test -s dist/vendor/three.core-0.185.1-narchi-v2.js \
  && test -s dist/vendor/manifest.json

# Image nginx officielle non-privilégiée : le worker tourne en UID 101
# (aucun processus root dans le pod — Trivy DS-0002).
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# §119 — corps commun des blocs 8080/8443 (inclus par les deux ; un seul
# endroit à corriger, jamais de divergence entre HTTP et HTTPS local).
COPY nginx-common.inc /etc/nginx/conf.d/narchi-common-locations.inc

USER 101:101
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:8080/ \
   && wget -q --spider http://127.0.0.1:8080/ifc/web-ifc.wasm \
   && wget -q --spider http://127.0.0.1:8080/ifc/web-ifc-api.js \
   && wget -q --spider http://127.0.0.1:8080/ifc/fragments-worker.mjs \
   && wget -q --spider http://127.0.0.1:8080/vendor/three.module-0.185.1-narchi-v2.js \
   && wget -q --spider http://127.0.0.1:8080/vendor/three.core-0.185.1-narchi-v2.js \
   || exit 1

CMD ["nginx", "-g", "daemon off;"]
