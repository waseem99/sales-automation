FROM node:20-slim AS app

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV LOCAL_LEAD_STORE_PATH=/data/leads.json

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile \
  && pnpm build \
  && mkdir -p /data

EXPOSE 3000

CMD ["pnpm", "start:web"]
