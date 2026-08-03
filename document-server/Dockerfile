FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable

COPY document-server/package.json document-server/pnpm-lock.yaml document-server/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY document-server/tsconfig.json ./
COPY document-server/src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist

USER app

EXPOSE 20100

ENTRYPOINT ["node", "dist/index.js"]
