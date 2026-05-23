# Build context: monorepo root
# docker build -f apps/api/Dockerfile -t linkr-api .

# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
RUN mkdir -p packages/shared-types packages/shared-utils packages/shared-config && \
    touch packages/shared-types/package.json packages/shared-utils/package.json packages/shared-config/package.json
RUN pnpm install --filter @linkr/api --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS build
WORKDIR /app
RUN npm install -g pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api ./apps/api
RUN pnpm --filter @linkr/api run build

# Stage 3: Runtime
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/main"]
