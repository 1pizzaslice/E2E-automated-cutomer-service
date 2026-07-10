# Production image for the Temporal worker entrypoint (Milestone 18).
#
# Build from the repository root:
#   docker build -f infra/production/worker.Dockerfile -t support-worker .
#
# Runs `tsx src/main.ts` (pnpm worker:start) — the production worker that
# composes the ticket-lifecycle activities, the AI sidecar bridge, and the
# per-tenant QA-sampling/retention schedule bootstrap. @support/api is a
# test-only devDependency of @support/workers, so --prod prunes it; the
# runtime closure is @support/db, @support/integrations, @support/observability
# and the Temporal SDK.

FROM node:24-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@support/workers deploy --prod --legacy /app

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PATH=/app/node_modules/.bin:$PATH
WORKDIR /app
COPY --from=builder --chown=node:node /app /app
USER node

# The worker exposes no port; liveness is proven by the Temporal poller. A
# lightweight process check keeps the container honest under Compose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "process.exit(0)"

CMD ["tsx", "src/main.ts"]
