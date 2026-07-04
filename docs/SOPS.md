# SOPs

## Purpose

This document defines operational SOPs for building and running the AI-first customer support BPO. It covers client onboarding, support workflows, QA, prompt/policy release, escalation, and incident handling.

Engineering implementation details live in `docs/BACKEND_SPEC.md` and `docs/AI_RUNTIME_HARNESS.md`. This file focuses on repeatable operations.

## 1. Client Onboarding SOP

Goal: Bring a new tenant live safely with accurate policies, KB, integrations, and support expectations.

Checklist:

- [ ] Create tenant.
- [ ] Confirm business name, brand voice, timezone, and support hours.
- [ ] Identify support channels for v1.
- [ ] Connect email channel.
- [ ] Connect WhatsApp channel.
- [ ] Collect historical tickets if available.
- [ ] Collect FAQ documents.
- [ ] Collect refund policy.
- [ ] Collect cancellation policy.
- [ ] Collect shipping policy.
- [ ] Collect escalation rules.
- [ ] Collect VIP/customer tier rules.
- [ ] Collect legal/chargeback handling rules.
- [ ] Connect order lookup integration or mock data.
- [ ] Confirm allowed and disallowed AI actions.
- [ ] Define SLA policy.
- [ ] Define QA sampling rate.
- [ ] Define pilot reporting cadence.
- [ ] Run KB ingestion.
- [ ] Run golden sample evals.
- [ ] Configure default automation mode as human approval.
- [ ] Conduct pilot readiness review.

Required onboarding artifacts:

- Active tenant policy versions.
- Active KB documents.
- Integration credentials or sandbox fixtures.
- SLA config.
- Escalation contacts.
- Pilot success metrics.

### 1.1 Pilot Onboarding (v1 Implementation)

Concrete steps with the current codebase (Milestone 12):

1. Start infrastructure (`pnpm infra:up`) and apply migrations
   (`pnpm db:migrate`).
2. Seed the pilot tenant: `pnpm db:seed:pilot` (idempotent; re-running is a
   no-op). This creates the `ten_pilot` tenant with a default retention
   policy (90-day raw payloads/attachments, 365-day AI runs), the six global
   roles, three users (`ops_admin`, `support_agent`, `qa_reviewer`) with
   role links, an active `mailgun` email channel whose secrets are
   environment-variable references (`PILOT_MAILGUN_SIGNING_KEY`,
   `PILOT_MAILGUN_API_KEY` — set the actual values in the deployment
   environment, never in config rows), an active default SLA policy
   (60/240/1440 minutes), active tenant policies for `refunds`,
   `escalation`, and `automation` (auto-send disabled, empty allowlist — the
   pilot default is human approval for everything), and the six global
   first-party `tool_definitions`. For a second pilot, call
   `buildPilotSeedPlan({ tenantId })` with a different tenant id.
3. Configure the provider webhook to
   `POST /v1/webhooks/email/mailgun?channel_id=chn_pilot_email` and confirm
   signature verification with a test delivery.
4. Ingest the client's KB via `POST /v1/kb/documents` +
   `POST /v1/kb/documents/{id}/ingest`, then spot-check
   `POST /v1/kb/search`.
5. Run the offline gates: `pnpm test:py` (golden dataset + injection suite
   hard-fail gates) and the API/DB integration suites against the live
   database.
6. Verify the effective automation controls read as disabled:
   `GET /v1/policies/automation` must return `auto_send_enabled: false`.
7. Confirm reporting works: `GET /v1/reports/pilot-weekly` returns the SOPS
   §14 metrics (zeros for a fresh tenant).
8. Schedule the QA sampling job (§10) and the retention job (§16) per
   tenant.

## 2. KB Ingestion SOP

Goal: Convert client support knowledge into versioned, retrievable evidence.

Steps:

1. Collect source docs.
2. Remove duplicates.
3. Identify conflicting policies.
4. Ask client to resolve conflicts.
5. Normalize into clear docs.
6. Tag by domain: FAQ, refund, cancellation, shipping, product, SOP.
7. Ingest documents.
8. Review chunks.
9. Run retrieval checks.
10. Activate approved versions.

Quality checklist:

- [ ] Refund policy has explicit eligibility.
- [ ] Cancellation policy has fulfillment-state rules.
- [ ] Shipping policy has time windows and exceptions.
- [ ] FAQ answers are current.
- [ ] Escalation paths are explicit.
- [ ] VIP handling is explicit.
- [ ] Outdated docs are archived or marked stale.

## 3. Policy Approval SOP

Goal: Ensure active policies are reviewed before AI uses them.

Policy lifecycle:

1. Draft.
2. Internal review.
3. Client review.
4. Approval.
5. Activation.
6. Archive old version.

Rules:

- AI can use only active policy versions for customer-facing answers.
- Draft policies can be used in sandbox evals only.
- Every activation creates an audit event.
- Policy changes require eval run for affected topics.

## 4. Ticket Handling SOP

Default V1 workflow:

1. Customer message arrives.
2. Ticket is created or updated.
3. AI classifies and enriches.
4. AI retrieves evidence.
5. AI calls allowed read-only tools.
6. AI drafts response.
7. Guardrail critic reviews.
8. Human reviews draft.
9. Human approves, edits, rejects, or escalates.
10. Response is sent.
11. Ticket waits for customer or resolves.
12. QA sample may be created.

Human reviewer checklist:

- [ ] Customer issue understood.
- [ ] AI used correct order/customer context.
- [ ] AI cited correct policy/KB evidence.
- [ ] Draft does not overpromise.
- [ ] Draft matches brand tone.
- [ ] Refund/cancellation language is policy-safe.
- [ ] Escalation is used when needed.
- [ ] Response is concise and useful.

## 5. Escalation SOP

Escalate to human-only when:

- Legal threat.
- Chargeback.
- Fraud suspicion.
- Safety issue.
- High-value/VIP sensitive complaint.
- Customer requests manager.
- AI confidence low.
- Missing policy.
- Contradictory policy.
- Required integration unavailable.
- Customer is highly angry.
- Potential privacy issue.

Escalation record must include:

- Reason code.
- Ticket summary.
- Customer latest message.
- Relevant evidence.
- Failed/missing tool calls.
- Suggested next action.

## 6. Refund SOP

V1:

- AI may determine eligibility using policy/tool evidence.
- AI may draft a response.
- AI may not execute refund.
- Human approval required.

Refund review checklist:

- [ ] Order identified.
- [ ] Payment captured.
- [ ] Fulfillment status checked.
- [ ] Refund window checked.
- [ ] Product/category exclusions checked.
- [ ] Prior refunds checked if available.
- [ ] Policy evidence cited.
- [ ] Customer response does not promise beyond policy.

V2/V3:

- Controlled refund execution can be added with thresholds, audit, approval, rollback/compensation plan, and client signoff.

## 7. Cancellation SOP

V1:

- AI may determine whether cancellation appears possible.
- AI may draft next steps.
- AI may not cancel order.
- Human approval required.

Cancellation review checklist:

- [ ] Order identified.
- [ ] Fulfillment status checked.
- [ ] Shipping label status checked if available.
- [ ] Cancellation window checked.
- [ ] Policy evidence cited.
- [ ] Customer response sets correct expectations.

## 8. Order Status SOP

AI may draft order status responses using:

- Order lookup tool.
- Shipment tracking tool.
- Shipping policy.

Auto-send can eventually be allowed if:

- Order is identified confidently.
- Tracking status is available.
- No complaint escalation flags.
- No refund/cancellation request mixed in.
- Critic passes.
- Tenant policy allows auto-send.

## 9. FAQ SOP

AI may answer FAQs from active KB.

Rules:

- Must cite active KB.
- Must not invent product details.
- Must route to human if KB is missing or contradictory.
- Auto-send can be considered after evals pass.

## 10. QA Sampling SOP

Sampling rate:

- Start with 20-30% of AI-assisted tickets during pilot.
- Sample 100% of auto-send candidates before auto-send is enabled.
- Sample 100% of high-risk categories.

QA review dimensions:

- Correct classification.
- Correct routing.
- Correct policy.
- Correct tool use.
- Evidence quality.
- Draft quality.
- Tone.
- Safety.
- Privacy.
- Resolution correctness.

Defect severity:

- Critical: tenant leak, unsafe refund promise, legal mishandling, privacy breach.
- High: wrong policy, missed escalation, hallucinated evidence.
- Medium: incomplete answer, poor tone, unnecessary escalation.
- Low: wording/style issue.

Sampling job (Milestone 11):

- `runQaSamplingJob` (`packages/workers/src/qa-sampling.ts`) implements the
  rates above per tenant: 100% of `auto_send` recommendations
  (`auto_send_candidate`), 100% of high-risk runs (`high_risk`), and a
  deterministic hash-bucketed random share of the rest (`random_sample`,
  default 25%). Candidates are completed AI runs with no QA review yet;
  re-runs are idempotent (deterministic `qa_review_id` + conflict-safe
  insert) and each new review emits `support.qa.review_created.v1`.
- Reviewers work the queue through the API: `GET /v1/qa-reviews?completed=false`
  to list open reviews, `GET /v1/qa-reviews/{id}/evidence` for the full
  package (conversation, messages, AI run + trace link, tool calls,
  approvals with the original AI draft and human edit), and
  `POST /v1/qa-reviews/{id}/complete` with the dimension scores (0-5) and
  defect taxonomy above.
- Until a scheduler exists, run the job from a worker process or an
  operational script per tenant on a daily cadence during pilot.

## 11. Prompt And AI Release SOP

Prompt/model/graph changes require:

- [ ] Change description.
- [ ] Prompt or graph version update.
- [ ] Golden eval run.
- [ ] Review of hard-fail cases.
- [ ] Shadow-mode run if available.
- [ ] Rollback plan.
- [ ] Docs update.
- [ ] `TODO.md` update.

Release stages:

1. Local eval.
2. Staging eval.
3. Shadow mode on pilot data.
4. Human approval mode.
5. Limited auto-send if eligible.

## 12. Tool Release SOP

New tool checklist:

- [ ] Tool purpose documented.
- [ ] Input schema defined.
- [ ] Output schema defined.
- [ ] Side-effect class defined.
- [ ] Permission class defined.
- [ ] Redaction policy defined.
- [ ] Timeout/retry policy defined.
- [ ] Audit behavior defined.
- [ ] Tests added.
- [ ] Human approval requirement defined.
- [ ] AI prompt/tool docs updated.

Write-capable tools require extra review:

- [ ] Client approval.
- [ ] Compensation/rollback plan.
- [ ] Rate limits.
- [ ] Manual kill switch.
- [ ] Full audit.
- [ ] Security review.

## 13. Incident Response SOP

Incident examples:

- Cross-tenant data exposure.
- Incorrect auto-send.
- Bad refund/cancellation promise.
- Integration writes wrong data.
- Webhook ingestion outage.
- Outbound send outage.
- AI provider outage.
- Major SLA breach.
- Prompt injection success.

Incident steps:

1. Triage severity.
2. Stop or reduce automation if needed.
3. Preserve logs/traces/audit.
4. Identify affected tenants/tickets.
5. Notify internal owner.
6. Notify client if required.
7. Mitigate.
8. Add regression test/eval.
9. Update SOP/docs.
10. Record postmortem.

Alert-to-incident mapping (Milestone 11): the alert definitions in
`infra/observability/alerts.yaml` page on the `support_critical_failures`
metric by `failure_mode` — `ai_graph_failed` (AI provider outage /
runtime regression), `outbound_send_failed` (outbound send outage),
`approval_signal_failed` (decision persisted but workflow not resumed —
redeliver the signal), `event_dead_letter` (event consumer dropping
messages; inspect `support.events.errors.>`), and `sla_breached` (major
SLA breach) — plus API 5xx rate, workflow activity failure rate, and
approval latency p95. Each firing alert enters this SOP at step 1; use
the shared `correlation_id`/`trace_id` on spans, logs, and audit events
to identify affected tenants/tickets (step 4).

Severity:

- SEV1: data leak, financial harm, broad outage.
- SEV2: tenant-specific outage or unsafe responses.
- SEV3: degraded automation or delayed workflows.
- SEV4: minor defect with no customer impact.

## 14. Weekly Pilot Review SOP

Review metrics:

- Ticket volume.
- First response time.
- Resolution time.
- SLA breaches.
- AI draft rate.
- Human approval rate.
- Auto-send rate.
- Escalation rate.
- QA defect rate.
- CSAT if available.
- Top topics.
- Top automation blockers.
- Policy gaps.
- KB gaps.
- Tool failures.

Outputs:

- Updated KB.
- Updated policy.
- New eval cases.
- New automation candidates.
- Defect fixes.
- Client action items.

## 15. Client Reporting SOP

Pilot report should include:

- Volume handled.
- SLA performance.
- Time saved estimate.
- Automation breakdown.
- Quality review summary.
- Customer pain points.
- Recommended policy/KB improvements.
- Risks and next steps.

Avoid overclaiming automation value until QA data supports it.

## 16. Data Handling SOP

Rules:

- Do not use real customer data in local fixtures unless explicitly sanitized.
- Redact PII from logs.
- Store raw payloads only when needed.
- Respect tenant retention settings.
- Limit trace access to authorized roles.
- Do not paste secrets into prompts.

Current implementation (Milestone 12):

- Log redaction is two-layered in `@support/observability`: secret-bearing
  keys (`authorization`, `api_key`, `secret`, `token`, `password`,
  `credential`, `cookie`) are replaced wholesale with `[REDACTED]`, and
  string content (including the log message itself) is scrubbed for emails,
  phone numbers, and card-like digit runs
  (`[REDACTED_EMAIL]`/`[REDACTED_PHONE]`/`[REDACTED_NUMBER]`). Key-based
  redaction cannot be disabled.
- Tenant retention settings live on `tenants.retention_policy`
  (BACKEND_SPEC §22). Run the retention job per tenant on a daily cadence:
  `runTenantRetentionJob` clears expired raw-payload references in bounded
  batches, reports planned attachment/AI-run purges, returns the cleared
  refs for the storage sweeper, and audits `retention.applied`. No
  configuration means nothing is purged.
- Integration secrets are environment-variable references validated by the
  shared `SecretResolver` (`packages/integrations`); config rows never hold
  secret values.

## 17. Auto-Send Expansion SOP

Before enabling auto-send for a topic:

- [ ] Topic is narrow and well-defined.
- [ ] Tenant policy allows it.
- [ ] Golden eval pass.
- [ ] Shadow-mode pass.
- [ ] QA approves samples.
- [ ] Kill switch exists.
- [ ] Metrics dashboard exists.
- [ ] Client signoff recorded.

Rollout:

1. 0% auto-send, human approval.
2. Shadow auto-send recommendation only.
3. 5% eligible tickets.
4. 25% eligible tickets.
5. 50% eligible tickets.
6. 100% eligible tickets.

Any critical defect rolls back to human approval.

Current implementation (Milestone 12): the tenant controls are stored as an
active `automation`-domain policy version
(`policy_versions.content = { auto_send_enabled, auto_send_allowed_topics }`,
topics constrained to the closed low-risk set `faq | order_status`).
`GET /v1/policies/automation` shows the effective controls;
`evaluateAutoSendEligibility` in `packages/workers` is the single gate a
future auto-send branch must consult (kill switch → succeeded run →
explicit `auto_send` recommendation → low risk → guardrails passed → draft
present → topic allowlisted; every check fails closed). The v1 workflow does
not auto-send at all — every outbound message requires a human approval
signal — so today the rollout ladder starts and stays at step 1 until the
send branch is implemented behind this gate. The kill switch is
`auto_send_enabled: false` on a new activated policy version (or archiving
the policy header), which takes effect on the next policy resolution.

## 18. SOP Update Rule

Update this file whenever:

- A new support process is added.
- A policy review process changes.
- A new high-risk action becomes possible.
- QA process changes.
- Incident process changes.
- Pilot reporting changes.
- Auto-send criteria changes.

## 19. Production Deployment Checklist

Run this checklist for every production (pilot) deployment. It encodes the
Milestone 12 security acceptance criteria; a deployment that cannot check
every box does not ship.

Environment and infrastructure:

- [ ] Separate credentials per environment; secrets exist only as environment
      variables named by the `*_ref` values in config rows (never plaintext
      in the database, repo, or prompts).
- [ ] Managed PostgreSQL provisioned; `pnpm db:migrate` applied and
      `schema_migrations` verified (0001-0004).
- [ ] RLS verified on the deployed database: the `support_app` role exists
      and a cross-tenant read/write smoke check fails.
- [ ] Temporal, NATS JetStream, Redis, and object storage reachable from the
      workers; OTel collector deployed with the Prometheus scrape endpoint,
      dashboards and alert rules loaded from `infra/observability/`.

Security gates (all automated — run the suites):

- [ ] Full offline suite green: `pnpm -r typecheck`, `pnpm lint`,
      `pnpm format:check`, `pnpm test` (includes the RBAC route matrix,
      attachment validation, secret-resolver, audit-completeness, retention,
      and auto-send eligibility tests).
- [ ] Python gates green: golden dataset + prompt-injection suite hard-fail
      gates (`pnpm test:py`; zero unsafe auto-send, zero cross-tenant leaks,
      injection pass rate 1.0).
- [ ] Live integration suites green against the deployed database
      (`pnpm test:integration`): tenant isolation, approval decision audit
      trail, send-once idempotency.
- [ ] Webhook signature verification confirmed with a real provider test
      delivery (bad signature rejected with 403).
- [ ] `GET /v1/policies/automation` returns `auto_send_enabled: false` for
      every tenant unless the Auto-Send Expansion SOP (§17) has been
      completed and signed off for a topic.

Tenant readiness:

- [ ] Pilot tenant seeded/verified (§1.1) with retention policy set and the
      QA sampling + retention jobs scheduled.
- [ ] KB ingested and retrieval spot-checked; golden evals re-run if policy
      or KB content changed.
- [ ] Escalation contacts and incident channel confirmed (§13); on-call
      owner for the deployment window identified.
- [ ] `GET /v1/reports/pilot-weekly` returns data; the weekly review (§14)
      is scheduled.

Rollback:

- [ ] Previous deployable artifact retained and the rollback command tested.
- [ ] Database migrations in this release are backward-compatible with the
      previous application version (additive-only), or a tested down-path
      exists.
- [ ] Any auto-send enablement in this release has its kill switch
      procedure (§17) verified before traffic.
