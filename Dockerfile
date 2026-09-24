################################################################################
# PNG Shop — Docker image for Cloud + On-Premise deployment
# One Codebase – Two Deployment Models (per Deployment Guideline)
#
# Build:
#   docker build -t png-shop:1.0.0 .
#
# Run (Cloud):
#   docker run -d -p 3000:3000 \
#     -v png-shop-data:/app/data \
#     -v png-shop-uploads:/app/uploads \
#     -v png-shop-backups:/app/backups \
#     -v png-shop-logs:/app/logs \
#     -e DATABASE_URL=file:/app/data/custom.db \
#     png-shop:1.0.0
#
# Run (On-Premise): same — customer controls env vars + volume mounts
################################################################################

# ---------- Stage 1: deps ----------
FROM node:22-slim AS deps

WORKDIR /app

# Install bun for fast dependency install
RUN npm install -g bun

# Copy lockfile + package.json first for cache
COPY package.json bun.lock* ./
COPY prisma ./prisma/

# Install production deps (use frozen lockfile for reproducible builds)
RUN bun install --frozen-lockfile --production

# Generate Prisma client (needs schema only)
RUN bunx prisma generate

# ---------- Stage 2: build ----------
FROM node:22-slim AS builder

WORKDIR /app

RUN npm install -g bun

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build Next.js standalone output
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ---------- Stage 3: runtime ----------
FROM node:22-slim AS runtime

WORKDIR /app

# Install only runtime essentials: curl for healthcheck, sqlite3 for ops
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    sqlite3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd --system --gid 1001 pngshop && \
    useradd --system --uid 1001 --gid pngshop --create-home --home-dir /app --shell /bin/bash pngshop

# ---------- Persistent directories (per Deployment Guideline Section 4) ----------
# /app     → application code (read-only after deploy)
# /data    → database persistent storage
# /uploads → user-uploaded files (images, slips, etc.)
# /config  → environment / settings / certificates (mounted, not embedded)
# /backups → database + file backups (separate from /data)
# /logs    → application / operational logs
RUN mkdir -p /app/data /app/uploads /app/config /app/backups /app/logs && \
    chown -R pngshop:pngshop /app

# Copy standalone build output (Next.js produces .next/standalone)
COPY --from=builder --chown=pngshop:pngshop /app/.next/standalone ./
COPY --from=builder --chown=pngshop:pngshop /app/.next/static ./.next/static
COPY --from=builder --chown=pngshop:pngshop /app/public ./public
COPY --from=builder --chown=pngshop:pngshop /app/prisma ./prisma
COPY --from=builder --chown=pngshop:pngshop /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=pngshop:pngshop /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=pngshop:pngshop /app/scripts ./scripts
COPY --from=builder --chown=pngshop:pngshop /app/package.json ./package.json

# Switch to non-root user
USER pngshop

# Default env (can be overridden at runtime)
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL=file:/app/data/custom.db
ENV UPLOAD_DIR=/app/uploads
ENV BACKUP_DIR=/app/backups
ENV LOG_DIR=/app/logs
ENV CONFIG_DIR=/app/config

# Volume declarations — operator maps them to local paths at runtime
VOLUME ["/app/data", "/app/uploads", "/app/config", "/app/backups", "/app/logs"]

EXPOSE 3000

# Health check (calls /api/system/version which returns 200 if app is alive)
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:3000/api/system/version || exit 1

# Run migration on container start (idempotent — skips existing rows),
# then start the server. Both run as the pngshop user.
CMD ["sh", "-c", "node scripts/migrate-from-shop.ts /app/data/migration-source.sqlite --dry-run 2>/dev/null; node server.js"]
