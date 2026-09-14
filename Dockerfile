# ---------- 阶段 1：构建前端 ----------
FROM node:20-slim AS webbuild
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 阶段 2：安装服务端生产依赖（完整镜像自带编译链，保障 better-sqlite3 可回退源码编译） ----------
FROM node:20-bookworm AS serverdeps
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 阶段 3：运行时 ----------
FROM node:20-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data
WORKDIR /app
RUN mkdir -p /app/data && chown -R node:node /app
COPY --from=serverdeps --chown=node:node /build/server/node_modules ./server/node_modules
COPY --chown=node:node server/ ./server/
COPY --from=webbuild --chown=node:node /build/web/dist ./web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
