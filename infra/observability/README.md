# Observability Definitions

Dashboards and alert definitions for the support platform (Milestone 11).
The services export OTLP traces/metrics to the local `otel-collector`
(`infra/docker-compose.yml`); the collector re-exposes metrics for
Prometheus-compatible scraping at `http://localhost:8889/metrics`.

## Metric naming

Metric instruments are defined once in
`packages/observability/src/attributes.ts` (`SUPPORT_METRIC_NAMES`) and
recorded through the `SupportMetrics` port. OTel names map to scraped names
dot-for-underscore with no added type/unit suffixes
(`translation_strategy: UnderscoreEscapingWithoutSuffixes` in
`infra/otel/otel-collector-config.yaml`; histograms still expose the
standard `_bucket`/`_sum`/`_count` series):

| OTel instrument                         | Scraped name                            | Type      | Key attributes                                                   |
| --------------------------------------- | --------------------------------------- | --------- | ---------------------------------------------------------------- |
| `support.api.requests`                  | `support_api_requests`                  | counter   | `http_request_method`, `http_route`, `http_response_status_code` |
| `support.api.request.duration_ms`       | `support_api_request_duration_ms`       | histogram | same as requests                                                 |
| `support.workflow.activity.executions`  | `support_workflow_activity_executions`  | counter   | `activity`, `outcome`                                            |
| `support.workflow.activity.duration_ms` | `support_workflow_activity_duration_ms` | histogram | `activity`, `outcome`                                            |
| `support.ai_run.completions`            | `support_ai_run_completions`            | counter   | `status`, `automation_mode`, `risk_level`                        |
| `support.ai_run.duration_ms`            | `support_ai_run_duration_ms`            | histogram | `status`                                                         |
| `support.tool_call.executions`          | `support_tool_call_executions`          | counter   | `tool`, `status`, `side_effect_class`                            |
| `support.tool_call.duration_ms`         | `support_tool_call_duration_ms`         | histogram | `tool`, `status`                                                 |
| `support.approval.requests`             | `support_approval_requests`             | counter   | `approval_type`                                                  |
| `support.approval.decisions`            | `support_approval_decisions`            | counter   | `decision`                                                       |
| `support.approval.latency_ms`           | `support_approval_latency_ms`           | histogram | `decision`                                                       |
| `support.critical_failures`             | `support_critical_failures`             | counter   | `failure_mode`                                                   |

`failure_mode` values: `ai_graph_failed`, `outbound_send_failed`,
`approval_signal_failed`, `event_dead_letter`, `sla_breached`.

## Tracing a ticket end to end

Every span carries the shared `support.*` attributes (`SUPPORT_ATTR`):
`support.correlation_id`, `support.tenant_id`, `support.ticket_id`, plus
domain ids (`support.ai_run_id`, `support.approval_id`, ...). One inbound
message's `correlation_id` flows from the API request span (`http.request`)
through every workflow activity span (`activity.*`), the AI run row
(`ai_runs.trace_id` links the persisted run to its trace and to the
runtime's redacted trace export), tool executions (`tool.execute`), the
approval decision (`approval.decide`), the outbound send, and the
`audit_events.correlation_id` column — so a ticket is traced end to end by
filtering any span/log/audit store on the correlation id (ADR-0018).

Structured logs carry `service`, `environment`, `trace_id`, `request_id`
or `correlation_id`, and `tenant_id`/`ticket_id`/`workflow_id`/`ai_run_id`
where available (DEVELOPMENT_RULES §13).

## Files

- `dashboards/support-overview.json` — Grafana dashboard covering API
  traffic/latency/errors, workflow activity health, AI runs, tool calls,
  approvals, and the critical-failure counter.
- `alerts.yaml` — Prometheus alert rules for the critical failure modes.
  Load them into any Prometheus-compatible ruler scraping the collector's
  `:8889` endpoint.

Neither Prometheus nor Grafana ships in the local Compose stack yet; these
are definitions-as-code so pilot infrastructure can adopt them unchanged.
To eyeball metrics locally: `curl http://localhost:8889/metrics`. Traces
and logs are visible via the collector's debug exporter
(`docker compose -f infra/docker-compose.yml logs otel-collector`).
