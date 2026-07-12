# Staging / Production Deploy Runbook

A production-shaped single-VM deployment of the support platform built from the
existing Compose stack (Milestone 18, ADR-0020/ADR-0027). Everything here runs
on one VM; managed PostgreSQL or Temporal Cloud are drop-in upgrades later.

This runbook is the operational companion to `docs/SOPS.md` §19 (the release
checklist). Run §19 for every deployment; this file explains the mechanics.

## What runs

| Service           | Role                                   | Exposure                        |
| ----------------- | -------------------------------------- | ------------------------------- |
| `caddy`           | TLS reverse proxy                      | Public `:80`/`:443`             |
| `api`             | Fastify API (`/v1/*`, webhooks)        | Internal only (via Caddy)       |
| `console`         | Reviewer console SPA (static)          | Internal only (via Caddy, `/`)  |
| `worker`          | Temporal worker + job schedules        | Internal only                   |
| `ai-service`      | Python AI sidecar (`/internal/ai/run`) | Internal only                   |
| `postgres`        | Source of truth (pgvector)             | Internal only                   |
| `redis`           | Cache / rate limits                    | Internal only                   |
| `nats`            | JetStream event bus                    | Internal only                   |
| `temporal`(`-ui`) | Durable workflows (+ UI)               | UI on `127.0.0.1:8080` (tunnel) |
| `minio`           | S3-compatible object store             | Console on `127.0.0.1:9001`     |
| `otel-collector`  | OTLP ingest + Prometheus exporter      | Internal only                   |
| `prometheus`      | Metrics + alert rules                  | `127.0.0.1:9090` (tunnel)       |
| `alertmanager`    | Alert routing → Slack                  | `127.0.0.1:9093` (tunnel)       |
| `grafana`         | Dashboards                             | `127.0.0.1:3001` (tunnel)       |
| `pg-backup`       | Nightly `pg_dump` + retention          | Internal only                   |

**Network model.** Only Caddy publishes public ports. Every datastore and
operator UI is either unpublished (reachable only by service name on the
internal Compose network) or bound to `127.0.0.1` so it is reachable **only**
through an SSH tunnel. Caddy proxies only `/v1/*` and `/health`; `/internal/*`
is refused at the edge and stays reachable solely on the internal network.

## Prerequisites (user-owned)

- A VM (Hetzner/EC2/DO) with Docker Engine + the Compose plugin.
- DNS: an A record for `STAGING_DOMAIN` → the VM's public IP (Caddy needs it to
  issue a Let's Encrypt cert).
- A Slack incoming-webhook URL for alerts (optional; drop in later).
- The pilot Clerk **production** instance (issuer + audience), plus Anthropic /
  OpenAI keys for the real model + embeddings.

## 1. Secrets

Copy the templates and fill them in on the VM (never commit the real files —
`infra/production/.gitignore` ignores them):

```bash
cd infra/production
cp .env.example .env                     # shared secrets + interpolation
cp env/api.env.example env/api.env       # Clerk issuer/audience, embeddings
cp env/worker.env.example env/worker.env # approval expiry, job schedules
cp env/ai.env.example env/ai.env         # LLM provider + key
```

`.env` is the single source of truth for anything shared (datastore passwords,
the internal machine tokens that must match across api/worker/ai, the image
tag). The `env/*.env` files hold each service's external provider/IdP secrets.
Follow the SecretResolver naming contract: secrets exist only as environment
variables, never in the database, repo, or prompts.

## 2. First-time bring-up

Images come from GHCR (pushed by CI) — set `REGISTRY`/`IMAGE_TAG` in `.env`.
To build on the VM instead, run `docker compose -f docker-compose.yml build`.

```bash
cd infra/production
export CF="docker compose -f docker-compose.yml"

$CF pull                                        # or: $CF build
$CF up -d postgres redis nats temporal otel-collector minio
$CF --profile setup run --rm migrate            # apply migrations 0001-0007
$CF --profile setup run --rm seed               # idempotent pilot tenant (§1.1)
$CF up -d                                        # api, worker, ai, caddy, monitoring, backups
```

Verify: `curl -k https://$STAGING_DOMAIN/health` returns `{"status":"ok",...}`.
On the real domain the cert is Let's Encrypt (drop `-k`); with
`STAGING_DOMAIN=localhost` Caddy uses a locally-trusted internal cert.

## 3. RLS smoke check (SOPS §19)

The `support_app` role and per-table policies key off `app.current_tenant_id`.
A cross-tenant access must fail:

```bash
docker compose -f docker-compose.yml exec -T postgres \
  psql -U support -d support -v ON_ERROR_STOP=0 <<'SQL'
SET ROLE support_app;
-- No tenant set -> tenant-scoped access raises (RLS is enforced):
SELECT count(*) FROM tickets;                       -- expect: ERROR
-- Wrong tenant -> zero rows, and cross-tenant insert is rejected:
SELECT set_config('app.current_tenant_id','00000000-0000-0000-0000-000000000000',false);
SELECT count(*) FROM tickets;                       -- expect: 0
SQL
```

## 4. Operator UIs (SSH tunnels)

None of these are public. Tunnel to the VM's localhost:

```bash
ssh -L 3001:127.0.0.1:3001 \
    -L 9090:127.0.0.1:9090 \
    -L 9093:127.0.0.1:9093 \
    -L 8080:127.0.0.1:8080 \
    -L 9001:127.0.0.1:9001 user@vm
# Grafana 3001, Prometheus 9090, Alertmanager 9093, Temporal UI 8080, MinIO 9001
```

## 5. Monitoring

Prometheus scrapes the collector's `:8889` exporter and evaluates
`infra/observability/alerts.yaml` (the Milestone 11 + 17 critical-failure and
job rules). Grafana auto-provisions the Prometheus datasource and the
`support-overview` dashboard. Alertmanager routes firing alerts to Slack via
`SLACK_WEBHOOK_URL` (rendered to a file the config reads, so the URL never
lands in an image or committed config). With no webhook set, alerts still fire
and are visible in the Alertmanager UI — they just do not deliver.

Fire a synthetic alert to test routing end to end:

```bash
curl -s -XPOST http://127.0.0.1:9093/api/v2/alerts -H 'content-type: application/json' -d '[
  {"labels":{"alertname":"SyntheticTest","severity":"critical"},
   "annotations":{"summary":"synthetic alert","description":"routing test"}}]'
```

## 6. Backups + restore drill

`pg-backup` takes a nightly custom-format `pg_dump` to the `pg-backups` volume,
checksums it, prunes past `BACKUP_RETENTION_DAYS`, and (if `BACKUP_UPLOAD_CMD`
is set) ships it offsite. Take one now and prove it restores:

```bash
cd infra/production
docker compose -f docker-compose.yml run --rm -e RUN_ONCE=true pg-backup
docker compose -f docker-compose.yml run --rm \
  --entrypoint bash pg-backup /opt/backup/pg-restore-drill.sh   # expect: PASS
```

**Offsite** is user-owned: set `BACKUP_UPLOAD_CMD` (e.g. an `aws s3 cp "$1"
s3://…` or `rclone copy "$1" remote:…`, invoked with the dump path as `$1`) and
ensure the tool is present in the image or a sidecar. **MinIO** data lives in
the `minio-data` volume; back it up with `mc mirror` to the same offsite target
(raw payloads/attachments are references, so MinIO loss degrades to missing
attachments, not lost tickets).

## 7. Deploy + rollback

CI (`.github/workflows/deploy.yml`) builds + pushes the **four** images
(`support-api`, `support-worker`, `support-ai`, `support-console`) to GHCR on a
`v*` tag, then — once you set the repo variable `DEPLOY_ENABLED=true` and the
`DEPLOY_SSH_*` / `DEPLOY_DIR` secrets — SSHes in and runs `deploy.sh`, which:

1. records the current tag (for rollback),
2. pins the new tag, pulls, applies migrations,
3. rolls the app services, and
4. health-gates the API — **auto-rolling-back** if the gate fails.

> **Console build-time config.** The console is a static Vite SPA, so its config
> is baked into the bundle **when CI builds the image** — it cannot be injected
> as runtime env on the VM. Set these as repository **variables** (not secrets;
> none is secret) before tagging a release, or the console ships misconfigured:
>
> | Repo variable                   | Purpose                                                               | Leave unset?                                                                          |
> | ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
> | `CONSOLE_CLERK_PUBLISHABLE_KEY` | Clerk **production** publishable key (`pk_live_…`). Public by design. | **No** — without it the console cannot sign anyone in.                                |
> | `CONSOLE_API_BASE_URL`          | API origin.                                                           | **Yes** — empty means same-origin, which is the Caddy topology here.                  |
> | `CONSOLE_TRACE_URL_TEMPLATE`    | Deep-link from a QA review to a trace viewer.                         | **Yes** — no trace backend is deployed yet (the collector exports traces to `debug`). |

Manual equivalents on the VM:

```bash
cd infra/production
./deploy.sh v1.2.3     # deploy a specific tag (health-gated)
./rollback.sh          # back to the previous tag (recorded by deploy.sh)
./rollback.sh v1.2.2   # back to a specific tag
```

Migrations in a release must be additive-only / backward-compatible with the
previous app version (SOPS §19 Rollback), so rollback never needs a down-migration.

## 8. Live suites against staging

Per SOPS §19, run the live integration suites once against the staging database
before taking traffic (from a checkout with `DATABASE_URL`/`NATS_URL` pointed at
staging, or tunneled): `pnpm test:integration`, and the Python gates
`pnpm test:py`. See SOPS §19 for the full box list.
