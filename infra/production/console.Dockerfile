# Production image for the reviewer console (Milestone 23, ADR-0028).
#
# Build from the repository root so the whole pnpm workspace is in context:
#   docker build -f infra/production/console.Dockerfile -t support-console .
#
# The console is a static Vite SPA: the builder runs `vite build` (a full
# workspace install is needed for its dev toolchain) and the runtime is a tiny
# Caddy that serves the built assets with an SPA history fallback. Vite bakes
# VITE_* values at build time, so they are build args, not runtime env. None is
# secret — VITE_API_BASE_URL is empty for same-origin (the console resolves it
# to window.location.origin), and the Clerk publishable key is public.

# ---- builder: install the frozen workspace, then build the static bundle ----
FROM node:24-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile

ARG VITE_API_BASE_URL=""
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ARG VITE_TRACE_URL_TEMPLATE=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    VITE_TRACE_URL_TEMPLATE=$VITE_TRACE_URL_TEMPLATE
RUN pnpm --filter=@support/console build

# ---- runtime: static file server with an SPA fallback ----
FROM caddy:2.10-alpine AS runtime
COPY infra/production/console/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /repo/apps/console/dist /srv
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1
