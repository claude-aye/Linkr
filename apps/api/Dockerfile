# syntax=docker/dockerfile:1.7
#
# Image de production de l'API (PR D3).
# Contexte de build : la racine du monorepo.
#   docker build -f apps/api/Dockerfile -t linkr-api .
#
# Les dépendances sont installées DANS le conteneur, depuis pnpm-lock.yaml
# (--frozen-lockfile). Le node_modules du poste n'entre jamais dans l'image
# (.dockerignore) : argon2 et sharp y ont des binaires Windows.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    CI=true
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# Manifestes seulement : la couche d'installation ne se reconstruit que si
# le lockfile ou un package.json change. Tous les manifestes du workspace
# sont copiés pour que --frozen-lockfile voie le même workspace que le lockfile.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/shared-config/package.json packages/shared-config/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@linkr/api..."

COPY apps/api apps/api
RUN pnpm --filter @linkr/api run build

# ---------------------------------------------------------------------------
# Dépendances de production seules, depuis le MÊME lockfile (--frozen-lockfile).
# Structure pnpm conservée : apps/api/node_modules contient des liens relatifs
# vers node_modules/.pnpm, que COPY préserve.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/shared-config/package.json packages/shared-config/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --prod --filter "@linkr/api..." \
      --config.package-import-method=copy

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=5000
WORKDIR /app/apps/api

COPY --from=prod-deps --chown=node:node /repo/node_modules /app/node_modules
COPY --from=prod-deps --chown=node:node /repo/apps/api/node_modules ./node_modules
COPY --chown=node:node apps/api/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist

# Dossier des envois (STORAGE_DRIVER=local), chemin absolu repris par le
# compose (STORAGE_LOCAL_DIR). Créé ici, au nom de `node`, pour qu'un volume
# nommé monté dessus hérite de ce propriétaire.
RUN mkdir -p /app/apps/api/storage/uploads && chown -R node:node /app/apps/api/storage

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/main"]
