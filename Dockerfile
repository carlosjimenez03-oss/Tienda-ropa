# ---------- Compilación ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- Ejecución ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/dist \
    UPLOADS_DIR=/data/uploads \
    MIGRATIONS_DIR=/app/server/migraciones
WORKDIR /app
RUN mkdir -p /data/uploads && chown -R node:node /data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/server/migraciones ./server/migraciones
COPY --from=build --chown=node:node /app/package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/salud || exit 1
CMD ["node", "dist-server/server/index.js"]
