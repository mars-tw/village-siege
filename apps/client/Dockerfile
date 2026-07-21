# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.15.0
ARG NODE_IMAGE_DIGEST=sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=village-siege-client-npm,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/shared/tsconfig.build.json packages/shared/tsconfig.build.json
COPY packages/shared/src packages/shared/src
COPY apps/client/tsconfig.json apps/client/tsconfig.json
COPY apps/client/vite.config.ts apps/client/vite.config.ts
COPY apps/client/index.html apps/client/index.html
COPY apps/client/src apps/client/src
COPY apps/client/public apps/client/public
COPY scripts/prune-runtime-art.mjs scripts/prune-runtime-art.mjs

ARG VITE_MULTIPLAYER_ENABLED=false
ARG VITE_COLYSEUS_URL
ARG VITE_BASE_URL=/
ENV VITE_MULTIPLAYER_ENABLED=${VITE_MULTIPLAYER_ENABLED} \
    VITE_COLYSEUS_URL=${VITE_COLYSEUS_URL}

RUN npm run build --workspace @village-siege/shared \
    && npm run build --workspace @village-siege/client -- --base="${VITE_BASE_URL}" \
    && node scripts/prune-runtime-art.mjs --runtime-dir apps/client/dist

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS runtime

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/client/dist ./public
COPY --chown=root:root deploy/static-server.mjs ./static-server.mjs
COPY --chown=root:root deploy/runtime-config.mjs ./runtime-config.mjs

USER node
EXPOSE 8080
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/_health').then(r=>{if(!r.ok)throw new Error(String(r.status))}).catch(()=>process.exit(1))"]

CMD ["node", "static-server.mjs"]
