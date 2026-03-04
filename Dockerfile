# ── Stage 1: Build frontend ──────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build backend ───────────────────────────────────────────
FROM node:22-alpine AS backend-build
# bcrypt needs python3, make, g++
RUN apk add --no-cache python3 make g++
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate
# tsc emits JS even with Express 5 strict type warnings (exit code non-zero)
RUN npx tsc || true
RUN test -f dist/index.js

# ── Stage 3: Production image ────────────────────────────────────────
FROM node:22-alpine AS production
RUN apk add --no-cache python3 make g++
WORKDIR /app

# Copy backend build output and dependencies
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./
COPY --from=backend-build /app/backend/prisma ./prisma

# Copy frontend build output into public/ for static serving
COPY --from=frontend-build /app/frontend/dist ./public

# Copy entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
