#!/usr/bin/env bash
# One-command rollback (Milestone 18, ADR-0027).
#
# Restores the previously-deployed image tag (recorded by deploy.sh in
# .previous_tag) or an explicit tag argument, then rolls the app services.
#
#   ./rollback.sh            # roll back to the tag deploy.sh last replaced
#   ./rollback.sh v1.2.3     # roll back to a specific tag
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env"
COMPOSE=(docker compose -f docker-compose.yml)

target="${1:-$(cat .previous_tag 2>/dev/null || echo latest)}"
echo "[rollback] restoring image tag ${target}"

if grep -qE '^IMAGE_TAG=' "$ENV_FILE"; then
  sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${target}|" "$ENV_FILE"
else
  echo "IMAGE_TAG=${target}" >> "$ENV_FILE"
fi

# DEPLOY_SKIP_PULL=1 uses locally-present images (air-gapped hosts / local drills).
if [[ "${DEPLOY_SKIP_PULL:-}" != "1" ]]; then
  "${COMPOSE[@]}" pull api worker ai-service console
fi
"${COMPOSE[@]}" up -d
echo "[rollback] restored ${target}"
