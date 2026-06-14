# ─── HartMonitor — production image ───────────────────────────────────────────
# Multi-stage build: install deps + build the frontend, then run the backend
# (which serves both the API and the built frontend on a single port).
#
# Works on any Docker host (a VPS, Render, Fly.io, Railway, etc.). The SQLite
# database should live on a mounted volume — set DATABASE_PATH (e.g. /data/mes.db)
# and BACKUP_DIR (e.g. /data/backups) to a path on that volume.

# Stage 1 — build
FROM node:20-bookworm AS build
WORKDIR /app

# Install all workspace dependencies (root + backend + frontend).
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm install

# Copy the source and build the frontend into frontend/dist.
COPY . .
RUN npm run build

# Stage 2 — runtime
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy the fully-built app (including node_modules with the compiled
# better-sqlite3 native binding, which is ABI-compatible across these images).
COPY --from=build /app /app

# The default; override on your host to your real public URL.
ENV PORT=3001
EXPOSE 3001

# Basic container healthcheck hitting the app's health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/src/index.js"]
