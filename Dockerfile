# syntax=docker/dockerfile:1.6
#
# PNG Shop — Containerized deployment image
#
# One codebase — two deployment models (cloud + on-premise). The mode is
# selected at runtime via the `DEPLOYMENT_MODE` env var (see
# `server/_core/deployment.ts`), not at build time, so the same image
# works for both Railway (cloud) and `docker-compose.yml` (on-premise).
#
# Required base image: `node:22-slim` — the project uses Node 22's
# built-in `node:sqlite` module (`server/sqliteStore.ts`, `server/routers.ts`,
# `server/sqliteBackup.ts`) so we cannot fall back to `node:20`.
#
# Build context must be the project root (the directory containing
# `package.json`, `pnpm-lock.yaml`, `client/`, `server/`, `shared/`).
#

FROM node:22-slim

WORKDIR /app

# --- 1. Install dependencies ------------------------------------------------
# Copy lockfile + manifest first to maximise Docker layer caching: source
# changes will only invalidate layers from step 2 onwards.
COPY package.json pnpm-lock.yaml ./

# Enable pnpm via corepack (bundled with Node 22). We install the FULL
# dependency tree (including devDependencies) because `pnpm run build`
# needs `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `esbuild`,
# `drizzle-kit`, `typescript` — all of which are devDependencies.
# After the build we `pnpm prune --prod` so the runtime image contains
# only the packages declared under `dependencies` in package.json
# (express, drizzle-orm, jose, @trpc/server, …) which the esbuild bundle
# marks as external (`--packages=external` in the build script).
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# --- 2. Build the application ----------------------------------------------
# `pnpm run build` runs:
#   1. `vite build`   → compiles React + Tailwind → dist/public/
#   2. `esbuild ... --format=esm --outdir=dist` → server bundle: dist/index.js
# The server's `serveStatic` helper resolves `dist/public` at runtime,
# so both outputs must land under `dist/`.
COPY . .
RUN pnpm run build

# --- 3. Prune to production-only node_modules ------------------------------
# The esbuild bundle keeps external imports (express, drizzle-orm, etc.)
# unresolved, so the runtime still needs `dependencies` from package.json.
# This step removes `devDependencies` (vite, esbuild, typescript, drizzle-kit)
# to shrink the image.
RUN pnpm prune --prod

# --- 4. Runtime configuration ---------------------------------------------
# `node:sqlite` is still flagged as experimental in the Node 22.x series,
# so the runtime needs `--experimental-sqlite`. We expose it via
# `NODE_OPTIONS` rather than baking it into the CMD so an operator who
# upgrades the base image to Node 24+ (where the flag becomes a no-op)
# does not need to rebuild.
ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--experimental-sqlite"

# Persistent data — declared as Docker VOLUME so an anonymous volume is
# created on `docker run` when the operator forgets to bind-mount.
# `docker-compose.yml` bind-mounts these to host paths for on-premise
# installs (see docs/ON_PREMISE_STRUCTURE_TH.md).
# Mount persistent storage through the deployment platform instead of Docker
# VOLUME declarations (Railway rejects these). On-premise deployments retain
# their explicit docker-compose bind mounts; Railway mounts its /data volume.

# --- 5. Run ----------------------------------------------------------------
# `dist/index.js` is the esbuild bundle produced by `pnpm run build`.
# It reads the same env vars as `pnpm dev`:
#   - PORT            (HTTP listen port — defaults to 3000 here)
#   - NODE_ENV         (production)
#   - DEPLOYMENT_MODE  (cloud / onpremise / development)
#   - SQLITE_DB_PATH   (where to find welfare-store.sqlite)
#   - JWT_SECRET, OWNER_OPEN_ID, OAUTH_SERVER_URL, … (see .env.example)
EXPOSE 3000
CMD ["node", "dist/index.js"]
