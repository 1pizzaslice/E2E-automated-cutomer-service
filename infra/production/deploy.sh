#!/usr/bin/env bash
# One-command deploy for the staging/production VM (Milestone 18, ADR-0027).
#
# Run ON the VM from this directory (where docker-compose.yml, .env, and
# env/*.env live). The CI deploy workflow invokes it over SSH; an operator can
# run it by hand. It pins the requested image tag, applies migrations, rolls
# the app services, health-gates, and auto-rolls-back on a failed gate.
#
#   ./deploy.sh <image_tag>
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:?usage: deploy.sh <image_tag>}"
ENV_FILE=".env"
COMPOSE=(docker compose -f docker-compose.yml)

[[ -f "$ENV_FILE" ]] || { echo "[deploy] missing $ENV_FILE (copy .env.example)"; exit 1; }

# Record the currently-deployed tag so rollback has a target.
current="$(grep -E '^IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2- || true)"
current="${current:-latest}"
echo "$current" > .previous_tag
echo "[deploy] current=${current} -> new=${TAG}"

# Pin the new tag in the env file (single source for interpolation).
if grep -qE '^IMAGE_TAG=' "$ENV_FILE"; then
  sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${TAG}|" "$ENV_FILE"
else
  echo "IMAGE_TAG=${TAG}" >> "$ENV_FILE"
fi

# DEPLOY_SKIP_PULL=1 uses locally-present images (air-gapped hosts / local drills).
if [[ "${DEPLOY_SKIP_PULL:-}" != "1" ]]; then
  echo "[deploy] pulling images"
  "${COMPOSE[@]}" pull api worker ai-service console
fi

# Migrations first. They are additive-only / backward-compatible (SOPS §19),
# so the still-running old app version tolerates the new schema.
echo "[deploy] applying migrations"
"${COMPOSE[@]}" --profile setup run --rm migrate

echo "[deploy] rolling app services"
"${COMPOSE[@]}" up -d

# Health gate against the API's /health via the container (no host port).
echo "[deploy] waiting for API health"
ok=false
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T api node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok=true; break
  fi
  sleep 5
done

if [[ "$ok" != true ]]; then
  echo "[deploy] HEALTH GATE FAILED on ${TAG} — rolling back to ${current}"
  ./rollback.sh
  exit 1
fi

echo "[deploy] healthy on ${TAG}"
