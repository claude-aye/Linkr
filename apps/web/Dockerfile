# syntax=docker/dockerfile:1.7
#
# Image de production du web (PR D3), sortie Next `standalone`.
# Contexte de build : la racine du monorepo.
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=http://api:5000 \
#     --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_... \
#     --build-arg NEXT_PUBLIC_MAPTILER_KEY=... \
#     -t linkr-web .
#
# ⚠️ Les trois NEXT_PUBLIC_* sont INLINÉES AU BUILD : l'image est liée à leurs
# valeurs. Les changer = reconstruire l'image, jamais un redémarrage.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/shared-config/package.json packages/shared-config/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@linkr/web..."

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_MAPTILER_KEY
# Refus franc si une valeur manque : seule NEXT_PUBLIC_API_URL fait échouer
# `next build` d'elle-même ; les deux autres dégraderaient en silence (ajout de
# carte éteint, « Carte indisponible »).
RUN for v in NEXT_PUBLIC_API_URL NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY NEXT_PUBLIC_MAPTILER_KEY; do \
      eval "val=\${$v}"; \
      if [ -z "$(echo "$val" | tr -d '[:space:]')" ]; then echo "Build arg $v is missing or empty" >&2; exit 1; fi; \
    done
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY} \
    NEXT_PUBLIC_MAPTILER_KEY=${NEXT_PUBLIC_MAPTILER_KEY} \
    NODE_ENV=production

COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @linkr/web run build

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# standalone reproduit l'arborescence du monorepo (outputFileTracingRoot) :
# server.js vit dans apps/web/. public/ et .next/static ne sont pas copiés par
# Next, d'où les deux COPY explicites. content/ (textes légaux) est rendu au
# build, mais copié par prudence : il est lu via process.cwd().
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/apps/web/content ./apps/web/content

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/web/server.js"]
