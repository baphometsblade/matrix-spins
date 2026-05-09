# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────
# Matrix Spins Casino — Production Container
# Multi-stage build:
#   1. deps       — install full dependency tree for build
#   2. builder    — run any build/asset bundling
#   3. runtime    — minimal image with only production deps + app
# ─────────────────────────────────────────────────────────────────────

# ── Stage 1: install dependencies ────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ \
    && ln -sf /usr/bin/python3 /usr/bin/python
COPY package*.json ./
RUN npm ci --no-audit --no-fund --include=optional || npm install --no-audit --no-fund

# ── Stage 2: build (asset bundling, dist generation) ─────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build || echo "build step is a no-op"

# ── Stage 3: production runtime ──────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Run as non-root for security
RUN addgroup -S casino && adduser -S casino -G casino

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# Copy app source from builder (includes any generated dist/)
COPY --from=builder /app/server ./server
COPY --from=builder /app/api ./api
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/blockchain ./blockchain
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/games ./games
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/css ./css
COPY --from=builder /app/js ./js
COPY --from=builder /app/img ./img
COPY --from=builder /app/images ./images
COPY --from=builder /app/admin ./admin
COPY --from=builder /app/categories ./categories
COPY --from=builder /app/blog ./blog
COPY --from=builder /app/tools ./tools
COPY --from=builder /app/arcade ./arcade
COPY --from=builder /app/deposit ./deposit
COPY --from=builder /app/*.html ./
COPY --from=builder /app/*.js ./
COPY --from=builder /app/*.css ./
COPY --from=builder /app/manifest.json ./
COPY --from=builder /app/sw.js ./
COPY --from=builder /app/robots.txt ./
COPY --from=builder /app/sitemap.xml ./
COPY --from=builder /app/favicon.svg ./

# Writable dirs the app may need (logs, sqlite fallback, uploads)
RUN mkdir -p /app/logs /app/data \
    && chown -R casino:casino /app

USER casino

EXPOSE 3000

# Container-level healthcheck — uses the lightweight ping endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/ping',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/index.js"]
