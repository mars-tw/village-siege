# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.15.0
ARG NODE_IMAGE_DIGEST=sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS build-dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=village-siege-server-build-npm,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts

FROM build-dependencies AS builder

COPY tsconfig.base.json ./
COPY apps/server/tsconfig.json apps/server/tsconfig.json
COPY apps/server/src apps/server/src
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/shared/tsconfig.build.json packages/shared/tsconfig.build.json
COPY packages/shared/src packages/shared/src

RUN npm run build --workspace @village-siege/shared \
    && npm run build --workspace @village-siege/server

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS production-dependencies

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=village-siege-server-production-npm,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --ignore-scripts \
      --workspace @village-siege/server \
      --workspace @village-siege/shared \
      --include-workspace-root=false \
    && npm cache clean --force

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS runtime

ENV NODE_ENV=production \
    PORT=2567

WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=production-dependencies --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --chown=root:root deploy/server-entrypoint.sh /usr/local/bin/village-siege-entrypoint

RUN chmod 0555 /usr/local/bin/village-siege-entrypoint

USER node

EXPOSE 2567
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD ["node", "-e", "const p=process.env.PORT||'2567';fetch('http://127.0.0.1:'+p+'/health/ready').then(r=>{if(!r.ok)throw new Error(String(r.status))}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/village-siege-entrypoint"]
CMD ["node", "apps/server/dist/index.js"]
