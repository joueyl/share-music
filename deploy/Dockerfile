FROM node:22.18-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages packages
COPY apps/server apps/server
COPY apps/client/package.json apps/client/package.json
RUN npm ci --ignore-scripts
RUN npm run build -w @music-share/server
RUN npm prune --omit=dev --ignore-scripts
FROM node:22.18-bookworm-slim
ENV NODE_ENV=production PORT=3000 BIND_ADDRESS=0.0.0.0 DATABASE_PATH=/data/music-share.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/apps/server/dist apps/server/dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","apps/server/dist/apps/server/src/main.js"]
