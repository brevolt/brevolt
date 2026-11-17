# Build from the repository root: docker build -f deploy/Dockerfile .
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++ && corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @brevolt/contracts build \
 && pnpm --filter @brevolt/core build \
 && pnpm --filter @brevolt/server build \
 && pnpm --filter @brevolt/dashboard build \
 && pnpm --filter @brevolt/server deploy --legacy --prod /out \
 && for p in contracts core; do \
      sed -i 's#"main": "./src/index.ts"#"main": "./dist/index.js"#' "/out/node_modules/@brevolt/$p/package.json" \
      && rm -rf "/out/node_modules/@brevolt/$p/src" "/out/node_modules/@brevolt/$p/test"; \
    done \
 && cp -r apps/dashboard/dist /out/dashboard \
 && rm -rf /out/src /out/test /out/tsconfig*.json /out/drizzle.config.ts

FROM node:22-alpine
# Minimal runtime: no package managers, non-root user, data only under /data.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn* \
 && mkdir -p /data /backups && chown node:node /data /backups
WORKDIR /app
COPY --from=build --chown=root:root /out /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/brevolt.db DASHBOARD_DIR=/app/dashboard
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/bin.js"]
