# Production image for the TypeScript API (Milestone 18, ADR-0020/ADR-0027).
#
# Build from the repository root so the whole pnpm workspace is in context:
#   docker build -f infra/production/api.Dockerfile -t support-api .
#
# The monorepo consumes its own packages as TypeScript source (every
# @support/* package's "exports" points at ./src/index.ts), so the runtime is
# tsx running the source directly — there is no cross-package compiled-JS
# path. `pnpm deploy --prod` produces a pruned, isolated node_modules that
# contains only @support/api's production dependency closure (tsx included, as
# a declared dependency) plus the workspace packages it needs.
#
# This same image also runs the one-shot migrate/seed commands (it depends on
# @support/db, whose source and migrations/ ship inside the deploy output) —
# see infra/production/docker-compose.yml.

# ---- builder: install the frozen workspace, then deploy a pruned API ----
FROM node:24-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /repo

# Full workspace copy (the root .dockerignore prunes node_modules/dist/.venv),
# then a frozen install so the deploy step can resolve workspace links.
COPY . .
RUN pnpm install --frozen-lockfile
# Pruned, self-contained deployment for the API package.
RUN pnpm --filter=@support/api deploy --prod --legacy /app

# ---- runtime: non-root tsx process ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    PATH=/app/node_modules/.bin:$PATH
WORKDIR /app
COPY --from=builder --chown=node:node /app /app
USER node
EXPOSE 3000

# Node-native healthcheck (no curl in the slim image). Overridable in Compose.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["tsx", "src/server.ts"]
