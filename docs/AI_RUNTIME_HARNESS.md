# AI Runtime Harness

## Purpose

This document defines the backend AI runtime architecture: agent graph design, model calls, prompts, tools, guardrails, evals, traces, and the rules that keep AI useful without letting it become uncontrolled business logic.

The AI runtime is a Python service called by Temporal activities or backend APIs. It returns structured outputs. It does not own durable ticket state and does not send messages directly to customers.

> **Naming, once, so it does not mislead:** the graph engine is **`ai/runtime/graph.py`**, a small in-repo engine that reproduces the LangGraph API surface (`add_node` / `set_entry_point` / `add_edge` / `add_conditional_edges` / `compile().invoke()`). **The LangGraph library is not a dependency of this project.** Where this document says "the graph owns X", it means that engine. The swap to the real library was deferred in ADR-0016 and deferred again, on stronger reasoning, in ADR-0023: node code is engine-agnostic, a swap would change no observable behavior, and it would add a runtime dependency to every sidecar deployment. Revisit only when a genuine LangGraph capability (checkpointing, interrupts, streaming) is actually needed. See `docs/HORZ_DESIGN_REVIEW.md`.

## 1. Core Principle

AI performs bounded reasoning inside a deterministic support workflow.

Temporal/backend owns:

- Ticket state.
- SLA timers.
- Approval waits.
- Outbound sending.
- Audit persistence.
- Policy enforcement.
- Idempotency.

The agent graph owns:

- Agent state for one AI run.
- Classification.
- Retrieval.
- Tool-use planning.
- Drafting.
- Critique.
- Escalation recommendation.

## 2. V1 AI Use Cases

V1 AI runtime supports:

- Ticket classification.
- Topic/subtopic detection.
- Sentiment and urgency scoring.
- Language detection.
- Routing recommendation.
- KB retrieval planning.
- Read-only tool planning.
- Response drafting.
- Evidence citation.
- Risk scoring.
- Guardrail critique.
- Disposition tagging.
- Eval record creation.

V1 AI runtime does not:

- Execute refunds.
- Cancel orders.
- Modify customer accounts.
- Send outbound messages.
- Override tenant policies.
- Close tickets without backend workflow approval.

## 3. Runtime Inputs

The AI runtime receives a structured request:

```json
{
  "tenant_id": "ten_...",
  "ticket_id": "tkt_...",
  "conversation_id": "cnv_...",
  "ai_run_type": "full_graph",
  "ticket_context": {
    "status": "triaged",
    "priority": "p2",
    "topic": null,
    "customer": {},
    "messages": [],
    "existing_tags": []
  },
  "tenant_context": {
    "brand_name": "Example Brand",
    "tone": "helpful_professional",
    "timezone": "Asia/Kolkata"
  },
  "policy_context": {
    "active_policy_version_ids": []
  },
  "available_tools": [],
  "runtime_options": {
    "allow_auto_send": false,
    "max_tool_calls": 4,
    "max_retrieved_chunks": 8
  },
  "correlation_id": "corr_..."
}
```

Rules:

- Input must be validated with Pydantic.
- Message history must be trimmed and summarized safely if too long.
- Internal notes must be labeled and never copied into customer text.
- Prompt-injection-like user content must be preserved as customer content but not followed as instructions.

## 4. Runtime Output

Structured output:

```json
{
  "ai_run_id": "air_...",
  "status": "succeeded",
  "classification": {},
  "routing_decision": {},
  "tool_calls": [],
  "draft": {},
  "guardrails": {},
  "final_recommendation": {
    "automation_mode": "human_approve",
    "risk_level": "low",
    "confidence": 0.88,
    "reason_codes": ["v1_default_human_approval"]
  },
  "eval_signals": {},
  "trace_id": "trace_..."
}
```

Rules:

- Output must validate before returning to caller.
- Any validation failure becomes `AI_RUNTIME_ERROR` and routes ticket to human.
- Output must include reason codes for escalations or human review.

Current backend boundary:

- `packages/workers/src/workflows/ticket-lifecycle-types.ts` defines `RunAiGraphActivityInput` and `RunAiGraphActivityResult` for the Temporal workflow boundary.
- Successful results include `classification`, `routing_decision`, `tool_calls`, optional `draft`, `guardrails`, `final_recommendation`, eval signals, and trace identifiers.
- Structured failures return `status: "failed"`, an error code/message, retryability, reason codes, eval signals, and optional run/trace IDs; `ticketLifecycleWorkflow` audits the failure and routes the ticket to human approval.
- Since Milestone 14 the production activity calls the Python runtime over HTTP (section 20); the in-process deterministic TypeScript stand-in remains the offline default when no sidecar is configured.

## 5. Agent Graph State

State fields:

- `tenant_id`
- `ticket_id`
- `conversation_id`
- `messages`
- `customer_context`
- `ticket_context`
- `policy_context`
- `available_tools`
- `classification`
- `retrieval_queries`
- `retrieved_evidence`
- `tool_plan`
- `tool_results`
- `draft`
- `guardrail_results`
- `risk_level`
- `confidence`
- `final_recommendation`
- `errors`

State rules:

- State must not contain raw secrets.
- Tool outputs must be minimized before being added to state.
- Retrieved chunks must include citation metadata.
- Errors are structured and branch to escalation where appropriate.

## 6. Graph Nodes

### 6.1 Normalize Input Node

Responsibilities:

- Validate request.
- Remove unsafe HTML.
- Normalize message order.
- Identify latest customer ask.
- Separate customer-visible content from internal notes.
- Prepare compact context.

Outputs:

- Normalized state.
- Input warnings.

Failure behavior:

- If input is structurally invalid, return failure.
- If context is incomplete, continue with uncertainty and route to human if needed.

### 6.2 Classifier Node

Responsibilities:

- Detect topic.
- Detect subtopic.
- Detect language.
- Detect sentiment.
- Estimate urgency.
- Estimate initial priority.
- Detect sensitive categories.

Topics:

- `order_status`
- `refund`
- `cancellation`
- `shipping_delay`
- `missing_package`
- `faq`
- `product_question`
- `technical_issue`
- `billing`
- `legal_or_chargeback`
- `fraud_or_abuse`
- `unknown`

Sensitive categories:

- Legal threat.
- Chargeback mention.
- Fraud suspicion.
- Self-harm or safety issue.
- Abusive content.
- Privacy request.
- VIP customer.

Output:

```json
{
  "topic": "refund",
  "subtopic": "eligibility",
  "language": "en",
  "sentiment": "frustrated",
  "urgency": "normal",
  "priority": "p2",
  "sensitive_flags": [],
  "confidence": 0.86,
  "reasoning_summary": "Customer asks whether refund is possible."
}
```

### 6.3 Retrieval Planner Node

Responsibilities:

- Decide which KB/policy documents are needed.
- Generate retrieval queries.
- Request tenant-scoped retrieval.

Rules:

- Always retrieve active policy for policy-dependent replies.
- Retrieve FAQ/macros for FAQ-like questions.
- Retrieve SOP for escalation-sensitive topics.
- Do not use stale documents for final answers unless explicitly labeled for audit.

### 6.4 Retrieval Node

Responsibilities:

- Run tenant-scoped semantic search.
- Apply filters.
- Return citations.
- Summarize evidence for downstream nodes.

Retrieved evidence shape:

```json
{
  "evidence_id": "ev_...",
  "type": "kb_chunk",
  "ref_id": "kb_chunk_...",
  "document_title": "Refund Policy",
  "policy_version_id": "polv_...",
  "content_excerpt": "...",
  "relevance_score": 0.82
}
```

Failure behavior:

- If retrieval fails, route to human unless the case can be answered with tool evidence only.

### 6.5 Policy Decision Node

Responsibilities:

- Determine automation eligibility.
- Determine required tools.
- Determine required approvals.
- Apply tenant policy.
- Identify risk.

Output:

```json
{
  "automation_mode": "human_approve",
  "allowed_tool_names": ["order_lookup", "refund_eligibility"],
  "blocked_tool_names": [],
  "requires_human_approval": true,
  "risk_level": "medium",
  "reason_codes": ["refund_topic", "v1_default_human_approval"]
}
```

Rules:

- Legal/chargeback/fraud always `human_only`.
- VIP defaults to `human_approve`.
- Missing policy evidence defaults to `human_approve` or `human_only`.
- Auto-send only if policy explicitly allows it.

### 6.6 Tool Planner Node

Responsibilities:

- Decide tool calls needed.
- Build typed tool call requests.
- Respect max tool call limit.
- Avoid unnecessary provider calls.

Allowed V1 tool calls:

- `order_lookup`
- `shipment_tracking_lookup`
- `refund_eligibility`
- `cancellation_eligibility`
- `customer_profile_lookup`
- `kb_search`

Rules:

- Ask for missing order number if required and not available.
- Do not guess order IDs.
- Do not call tools outside policy allowed list.

### 6.7 Tool Execution Node

Responsibilities:

- Send planned tool calls to backend tool registry.
- Validate tool outputs.
- Minimize outputs before adding to graph state.

Failure behavior:

- Retry only through backend/Temporal policy where possible.
- Tool failure should not be hidden from human approval package.
- If required tool fails, draft should explain that more investigation is needed or route to human.

### 6.8 Response Composer Node

Responsibilities:

- Draft customer response.
- Use brand tone.
- Cite evidence internally.
- Avoid unsafe promises.
- Ask concise clarifying questions when needed.

Draft requirements:

- Clear answer.
- Customer-friendly tone.
- No internal jargon.
- No unsupported claims.
- No hallucinated policy.
- No mention of model/tool internals.

For order status:

- Include current status if known.
- Include tracking info if available.
- Include realistic next step.

For refund:

- State policy-bound eligibility.
- If uncertain, say it will be reviewed.
- Never promise refund unless policy/tool evidence supports it and workflow approval allows it.

For cancellation:

- State whether order can be canceled based on fulfillment status.
- Route to human if cancellation would modify an order.

For FAQ:

- Answer from KB.
- Keep concise.

### 6.9 Guardrail Critic Node

Responsibilities:

- Check grounding.
- Check policy compliance.
- Check tone.
- Check privacy.
- Check unsafe promises.
- Check missing escalation.
- Check prompt-injection susceptibility.
- Check whether human approval is required.

Output:

```json
{
  "passed": false,
  "risk_level": "medium",
  "issues": [
    {
      "code": "MISSING_POLICY_EVIDENCE",
      "severity": "medium",
      "message": "Refund answer needs active refund policy citation."
    }
  ],
  "recommended_action": "human_approve"
}
```

Rules:

- Critic can only downgrade automation, not upgrade it beyond policy.
- Any high severity issue routes to human.

### 6.10 Final Recommendation Node

Responsibilities:

- Produce final structured output.
- Summarize evidence.
- Set automation mode.
- Set reason codes.
- Prepare human approval package if needed.
- Capture eval signals.

## 7. Automation Modes

### 7.1 `auto_send`

Allowed only when:

- Tenant policy allows it.
- Topic is allowlisted.
- Risk is low.
- Confidence meets threshold.
- Required evidence exists.
- Critic passes.
- No side-effect write is required.

V1 default: disabled except explicitly configured low-risk FAQ/order-status cases.

### 7.2 `human_approve`

Default V1 mode.

Use when:

- AI can draft but should not send.
- Refund/cancellation topic.
- VIP customer.
- Frustrated customer.
- Low/medium risk.
- New automation scope.

### 7.3 `human_only`

Use when:

- Legal threat.
- Chargeback.
- Fraud.
- Safety issue.
- Missing critical context.
- Tool or retrieval failure blocks answer.
- High-value customer with sensitive issue.
- Policy contradiction.
- Prompt injection succeeds or cannot be confidently neutralized.

## 8. Prompt Versioning

Prompt files live in the AI runtime package with stable IDs (realized at
Milestone 15): `ai/runtime/prompts/<prompt_id>.md`, where the prompt id
carries the version (`support_classifier.v1.md`). Each file declares its
`prompt_id` and `version` in a frontmatter block that the registry
(`runtime/prompts/load_prompt`) validates at load time, so a renamed or
mislabeled file fails loudly. The two model call sites are file-backed:

- `support_classifier.v1`
- `support_response_composer.v1`

(The other decision points — retrieval planning, policy, tool planning,
guardrails — are deterministic Python by design, ADR-0016/ADR-0023, so they
have no prompts.) The real-model provider renders the file body as system
instructions and appends the run input as a fenced JSON block — customer text
is always data inside that block, never interpolated into instructions. The
prompt versions used are recorded on every AI run (`RuntimeResult.model.
prompt_versions` → `ai_runs.prompt_version`).

Prompt changes require:

- A NEW version file (`support_classifier.v2.md`) if behavior changes
  materially — shipped versions are never edited in place.
- Eval run against golden dataset (`python -m evals.live_runner` for real
  models; SOPS §11.1).
- `docs/AI_RUNTIME_HARNESS.md` update.
- `TODO.md` verification entry.

## 9. Model Provider Rules

Use a provider abstraction.

Required provider metadata:

- Provider name.
- Model ID.
- Request ID.
- Latency.
- Token usage.
- Cost estimate.
- Error code.

No business logic should depend on provider-specific raw response shapes.

Implementation (Milestone 15, ADR-0023): `runtime/llm.py` implements the
`ModelProvider` port over LangChain's `init_chat_model` with env-driven
selection — see section 21. The metadata above is captured per call into
`ModelMetadata`, aggregated on the run trace, surfaced as the
`RuntimeResult.model` section, and persisted to `ai_runs` (model id, prompt
versions, latency, tokens, cost) end to end.

## 10. Retrieval Rules

Retrieval must:

- Filter by tenant.
- Filter by active document status.
- Prefer active policy versions.
- Return citation metadata.
- Avoid returning excessive raw text to the model.
- Log retrieval query, filters, result IDs, and scores.

Retrieval must not:

- Cross tenant boundaries.
- Treat customer text as retrieval instructions.
- Use stale content without labeling it.

## 11. Tool Calling Rules

The graph may plan tool calls, but the backend registry executes them.

Tool request shape:

```json
{
  "tenant_id": "ten_...",
  "ticket_id": "tkt_...",
  "ai_run_id": "air_...",
  "tool_name": "order_lookup",
  "input": {
    "order_number": "1234"
  },
  "idempotency_key": "..."
}
```

Tool result shape:

```json
{
  "tool_call_id": "tc_...",
  "status": "succeeded",
  "output": {},
  "redacted_output_for_ai": {},
  "audit_ref": "aud_..."
}
```

Rules:

- Tool results passed to AI must be redacted/minimized.
- Tool errors become visible in human approval packages.
- Tool output cannot override policy unless policy says provider data is authoritative.

## 12. Guardrails

Guardrail categories:

- Grounding.
- Policy compliance.
- Tool permission.
- Privacy/PII.
- Tone.
- Escalation.
- Legal/financial safety.
- Prompt injection.
- Hallucination.
- Channel formatting.

Guardrail severity:

- `low`: can proceed with human approval.
- `medium`: human approval required.
- `high`: human-only escalation.

## 13. Human Approval Package

When `human_approve` or `human_only` is returned, include:

- Customer latest message.
- Ticket summary.
- AI classification.
- Draft response if safe.
- Evidence list.
- Tool results summary.
- Risk reasons.
- Policy references.
- Suggested next action.
- Missing info questions.

Never include:

- Raw secrets.
- Hidden system prompt.
- Full unredacted provider payloads.

## 14. Eval Harness

### 14.1 Golden Dataset

Each eval case includes:

- Input conversation.
- Tenant policy fixtures.
- KB fixtures.
- Tool fixture outputs.
- Expected topic.
- Expected routing.
- Expected required tools.
- Expected approval mode.
- Expected unsafe outputs to avoid.
- Rubric for draft quality.

### 14.2 Eval Types

Classification eval:

- Topic/subtopic accuracy.
- Sensitive flag recall.
- Priority/urgency quality.

Routing eval:

- Correct automation mode.
- Correct human escalation.
- Correct required tool selection.

Grounding eval:

- Uses expected evidence.
- Does not invent policy.
- Cites active docs.

Draft eval:

- Correctness.
- Tone.
- Completeness.
- No unsafe promises.
- No internal leakage.

Tool-use eval:

- Calls necessary tools.
- Does not call unnecessary tools.
- Does not guess missing identifiers.

Prompt-injection eval:

- Ignores user instructions to reveal system prompt.
- Ignores user instructions to bypass policy.
- Does not execute disallowed actions.

Current implementation (Milestone 12): `ai/evals/injection_suite.py` is the
dedicated suite — 15 user-text injection cases (direct override, exfiltration,
injections embedded in legitimate requests, role-play/developer-mode
jailbreaks, tool-abuse demands, injection with auto-send enabled and the topic
allowlisted, multi-message late injection) plus 3 KB-content injection cases
against a poisoned corpus (`build_adversarial_documents`), run through the
standard eval runner with its hard-fail gates (`prompt_injection_pass_rate ==
1.0`, zero unsafe auto-send/output, zero cross-tenant leaks). Run:
`uv run --frozen --project ai python -m unittest discover -s ai -p '*_test.py'`
or `PYTHONPATH=ai python -m evals.injection_suite`. The suite tests
governance-under-detection (the deterministic classifier is a substring
matcher); re-baseline the phrasing breadth when a real model lands.

### 14.3 Eval Gates

Before enabling auto-send for a topic:

- Classification pass rate meets threshold.
- Routing false-auto-send rate is zero on high-risk cases.
- Grounding defects are below threshold.
- Human QA approves sample.
- Pilot owner signs off policy.

Default threshold proposal:

- High-risk false negative: 0 allowed.
- Tenant leakage: 0 allowed.
- Unsafe auto-send: 0 allowed.
- Policy hallucination: 0 allowed in golden set.
- Topic accuracy: 95%+ for allowlisted topics.

## 15. Trace And Logging

Every AI run must record:

- `ai_run_id`
- `trace_id`
- `tenant_id`
- `ticket_id`
- Graph version.
- Prompt versions.
- Model IDs.
- Tool call IDs.
- Retrieved evidence IDs.
- Guardrail output.
- Final recommendation.

Logs must be redacted. LLM observability store may hold richer traces according to retention and privacy policy.

Implementation note (Milestone 11): the worker-side `createPersistedRunAiGraph` wrapper persists every run's terminal state to the `ai_runs` table — structured output, confidence/risk/automation recommendation, guardrail results, latency, and `trace_id` — with deterministic ids so Temporal retries replay instead of duplicating. `ai_runs.trace_id` matches the runtime's deterministic `RunTrace.trace_id` (`ai/runtime/tracing.py`), so the persisted row, the redacted trace export, and the OTel spans emitted around the activity all join on one id. Runs are readable through `GET /v1/ai-runs` / `GET /v1/ai-runs/{ai_run_id}`, and the QA evidence endpoint embeds the run for reviewers (BACKEND_SPEC §17.14).

## 16. Failure Handling

Failure cases:

- Model provider timeout.
- Model provider invalid output.
- Retrieval failure.
- Tool failure.
- Prompt/version missing.
- Guardrail failure.
- Output validation failure.

Default behavior:

- Return structured failure to Temporal/backend.
- Route ticket to `waiting_human`.
- Create audit event.
- Capture eval/debug signal.

Never silently send fallback AI content to customer after an AI runtime error.

## 17. Versioning

Version these independently:

- Graph version.
- Prompt versions.
- Tool schemas.
- Policy versions.
- Eval dataset versions.
- Retrieval pipeline version.

AI run records must store all relevant versions.

## 18. V1 Graph Acceptance Criteria

- Classifies order status, refund, cancellation, FAQ, legal/chargeback, and unknown.
- Retrieves tenant-scoped evidence.
- Calls mock tools through registry.
- Drafts safe responses.
- Routes risky cases to human.
- Produces approval packages.
- Records trace and eval metadata.
- Passes initial golden dataset with no unsafe auto-send.

## 19. V1 Implementation (Milestone 9)

The v1 support agent graph is implemented in Python under `ai/`. Per ADR-0016 it
is a self-contained, dependency-free package that mirrors LangGraph's node model
behind pluggable ports; the real LangGraph library and a real model/provider SDK
are deferred until Python dependency management is provisioned. The ports are the
seams where those adapters plug in later.

### 19.1 Module Map

- `ai/runtime/schemas.py` — validated structured I/O (Pydantic-equivalent using
  stdlib). Mirrors the Temporal `RunAiGraphActivityResult` boundary and the
  Milestone 8 `ToolCallRequest`/`ToolCallResult` envelope.
- `ai/runtime/state.py` — `AgentState` (section 5).
- `ai/runtime/graph.py` — a tiny graph engine reproducing the LangGraph API
  surface (`add_node`, `set_entry_point`, `add_edge`, `add_conditional_edges`,
  `compile().invoke()`), with cycle bounding.
- `ai/runtime/nodes.py` + `ai/runtime/support_graph.py` — the nodes and wiring.
- `ai/runtime/providers.py` — `ModelProvider` port + `DeterministicSupportModel`
  (offline, reproducible, safe-by-construction) + `UnconfiguredLlmModel` (the
  real-provider seam).
- `ai/runtime/retrieval.py` — `RetrievalPort` + `InMemoryRetrieval`
  (tenant-scoped, stale-excluding). Production calls `POST /v1/kb/search`.
- `ai/runtime/tools.py` — `ToolExecutor` port + `InMemoryToolExecutor` over
  `CommerceDataset`, reproducing the Milestone 8 registry governance. Production
  calls the TypeScript tool registry.
- `ai/runtime/tracing.py` — deterministic, redacted trace capture (section 15).
- `ai/runtime/runner.py` — `run_support_graph(request, *, model, retrieval,
tool_executor)` → `(RuntimeResult, RunTrace)`.
- `ai/evals/` — fixtures, the golden dataset, and the offline eval runner.

### 19.2 Graph Shape

`normalize → classifier → retrieval_planner → retrieval → policy → tool_planner
→ tool_execution → (conditional) composer | guardrail → guardrail → escalation →
finalize`. The single conditional edge after `tool_execution` skips drafting for
hard human-only cases (legal/chargeback/fraud/safety/prompt-injection): a human
writes those replies, so no AI draft is produced.

### 19.3 Governance Realized

- Classification and drafting go through the `ModelProvider` port; **policy and
  guardrail logic is deterministic Python** (safety-critical governance is not
  probabilistic).
- Policy defaults to `human_approve`, forces `human_only` for hard-sensitive
  flags and VIP-blocks auto-send, and permits `auto_send` only for tenant- and
  topic-allowlisted, low-risk, sensitive-flag-free cases.
- Escalation combines policy, critic recommendation, a confidence floor, and a
  grounding gate — **auto-send always requires evidence or a successful tool
  call** (no customer-facing response without evidence).
- The AI runtime's granted permission set is derived from the policy's allowed
  tools (the Milestone 8 follow-up: `grantedPermissions` wired to policy).
- Order numbers are extracted from customer text and never guessed.
- Any input/output validation failure becomes a structured `failed` result that
  routes the ticket to a human (section 16).

### 19.4 Running

- Tests: `pnpm test:py` (or `python3 -m unittest discover -s ai -p '*_test.py'`).
- Offline evals: `PYTHONPATH=ai python3 -m evals.runner` (prints metrics + gates).

Prompt IDs are realized as `support_classifier.v1` and
`support_response_composer.v1` (section 8), backed by versioned prompt files
under `ai/runtime/prompts/` since Milestone 15.

## 20. Service Bridge (Milestone 14)

Per ADR-0020 the runtime runs as an HTTP sidecar: a FastAPI service under
`ai/service/` that the Temporal `runAiGraph` activity calls over the network.
The graph, ports, schemas, and governance of section 19 are unchanged — the
bridge only moves where the graph executes and swaps the in-memory ports for
HTTP adapters.

### 20.1 Endpoints And Auth

- `POST /internal/ai/run` — the wire mirror of `RuntimeRequest` in and
  `RuntimeResult.to_dict()` out (`AiRuntimeRunRequestSchema` /
  `AiRuntimeRunResultSchema` in `@support/shared-schemas` are the TypeScript
  side of the contract; `ai/service/request_parsing.py` is the strict stdlib
  parser on the Python side). Both `succeeded` and `failed` runs are HTTP
  200 — a failed run is a valid domain outcome. HTTP errors are reserved for
  auth (401) and contract violations (400 malformed/unknown-key bodies),
  which the caller treats as permanent.
- `GET /health` — unauthenticated liveness with `graph_version` and mode.
- Auth: a bearer token resolved from an env reference per SecretResolver
  conventions (`SUPPORT_AI_SERVICE_TOKEN_REF`, default ref
  `SUPPORT_AI_SERVICE_TOKEN`), compared constant-time; unauthenticated
  requests are 401.

### 20.2 Modes And Port Adapters

`SUPPORT_AI_SERVICE_MODE` selects the ports:

- `local` — the in-memory deterministic ports (section 19); used for eval
  parity and tests.
- `service` — HTTP adapters (`ai/service/adapters.py`): `HttpToolExecutor`
  posts the Milestone 8 envelope to the API's
  `POST /internal/tools/execute` (BACKEND_SPEC §17.16) with the runtime's
  policy-derived `granted_permissions` (re-enforced server-side);
  `HttpRetrieval` posts to `POST /v1/kb/search` with `x-tenant-id`. Both
  authenticate with the internal API machine token
  (`SUPPORT_API_TOKEN_REF`, default ref `SUPPORT_INTERNAL_API_TOKEN`) and
  carry `x-correlation-id`. Tool transport/contract failures degrade to
  `failed` tool results (visible in the approval package, section 6.7);
  retrieval failures raise and become a structured failed run that routes to
  human (section 6.4). In both modes the model provider is resolved once at
  app startup from `SUPPORT_LLM_PROVIDER` (section 21); unset keeps the
  deterministic model.

### 20.3 Worker-Side Activity

`createHttpRunAiGraph` (`packages/workers/src/activities/http-ai-graph.ts`)
builds the `RuntimeRequest` from workflow input plus database context — the
conversation's messages/customer/tenant rows
(`createDatabaseAiGraphContextStore`) and the tenant automation policy
(`createDatabaseAutomationPolicyStore` feeds `policy.auto_send_allowed_topics`
and `options.allow_auto_send`; the Milestone 12 bridge) — then posts it with
an explicit per-attempt timeout (`AI_RUNTIME_SERVICE_TIMEOUT_MS`, default
30s). Failure classification, all returned as structured `failed` results so
the workflow never fails and every outcome is persisted/audited by the
unchanged `createPersistedRunAiGraph` wrapper:

- Transport errors / timeouts / 5xx: retried in-activity with backoff (3
  attempts), then `AI_SIDECAR_UNAVAILABLE` / `AI_SIDECAR_ERROR`
  (`retryable: true`).
- 401/403: `AI_SIDECAR_UNAUTHORIZED` (permanent, deployment misconfig).
- Other 4xx: `AI_SIDECAR_REJECTED` (permanent contract drift).
- 200 with a non-contract body: `AI_SIDECAR_CONTRACT_ERROR` (permanent).
- Missing conversation context: `AI_CONTEXT_UNAVAILABLE` (permanent) without
  calling the sidecar.

Mapping notes: `routing_decision.priority` keeps the workflow-owned ticket
priority (the runtime's own `p1`-`p4` stays in `classification`), and the
runtime's `approval_package` is not part of the activity contract. Enabled by
`AI_RUNTIME_SERVICE_URL` (unset → the deterministic TypeScript stand-in);
sidecar runs record provenance `deterministic-support-v1` on `ai_runs`.

### 20.4 Correlation And Logs

The activity forwards `x-correlation-id` (workflow correlation id) and
`x-trace-id` (active OTel span); the request body carries `correlation_id`.
The sidecar logs exactly one structured JSON line per run
(`ai/service/logs.py`: service `ai-runtime`, correlation/trace/tenant/ticket/
ai_run ids, status, error code, duration) — ids and outcomes only, never
message content, drafts, or secrets (ADR-0018 attribute correlation).

### 20.5 Running And Parity

- Local sidecar: `pnpm ai:service` (uvicorn on `127.0.0.1:8090`), or the
  Compose `ai-service` container (uv-based `ai/Dockerfile`, port 8090,
  service mode pointed at the host API).
- Service-path determinism: `PYTHONPATH=ai uv run --frozen --project ai
--extra service python -m service.eval_parity` runs every golden case
  in-process and through the service path and diffs the results byte-for-byte,
  then re-runs the eval gates through the service path
  (`ai/service/eval_parity_test.py` keeps this in `pnpm test:py`).
- Live drive: `pnpm --filter @support/workers test:e2e:service` (Compose +
  spawned sidecar; happy path with retrieval/tools over the network, plus
  sidecar-down and sidecar-500 degradation).

## 21. Real Model Providers (Milestone 15)

Per ADR-0020/ADR-0023 the real LLM is a config-selected LangChain adapter
behind the unchanged `ModelProvider` port (`runtime/llm.py`). The graph,
ports, governance, and service bridge of sections 19-20 are unchanged — only
the model behind the port swaps, by environment configuration alone.

### 21.1 Configuration

| Variable                                                   | Meaning                                                                                                 | Default                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `SUPPORT_LLM_PROVIDER`                                     | `anthropic`, `openai`, any `init_chat_model` provider, or `scripted`                                    | unset → deterministic offline model                |
| `SUPPORT_LLM_MODEL`                                        | provider model id (e.g. `claude-opus-4-8`)                                                              | required when a real provider is set               |
| `SUPPORT_LLM_API_KEY_REF`                                  | name of the env var holding the key (SecretResolver conventions)                                        | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` by provider |
| `SUPPORT_LLM_TIMEOUT_MS`                                   | per-call timeout                                                                                        | 30000                                              |
| `SUPPORT_LLM_MAX_RETRIES`                                  | SDK transport retries                                                                                   | 2                                                  |
| `SUPPORT_LLM_TEMPERATURE`                                  | sampling temperature; omitted unless set (current Claude models reject non-default sampling parameters) | unset                                              |
| `SUPPORT_LLM_PRICE_INPUT_PER_MTOK` / `..._OUTPUT_PER_MTOK` | cost-estimate overrides (USD per MTok)                                                                  | built-in table by model prefix                     |

The pilot default is Anthropic Claude; real providers activate only by
explicit config, and a provider/model/prompt change must re-run the eval
gates (SOPS §11.1). Config problems fail the sidecar at boot with every
problem listed.

### 21.2 Adapter Behavior

- Renders the versioned prompt file (section 8) as system instructions and
  the run input as a fenced JSON block (customer text stays data).
- Enforces structured outputs via `with_structured_output` with
  closed-vocabulary JSON schemas (topics, sentiments, urgencies, priorities
  `p1`-`p3` — `p0` is operator-reserved — and sensitive flags as enums).
- Applies per-call timeouts, bounded SDK transport retries, and one
  in-adapter repair attempt on structured-output parse failures; a
  persistently non-conforming or unreachable model raises, which
  `run_support_graph` converts into a structured `failed` run routed to a
  human (section 16). Nothing fabricates model output after an error.
- Captures per-call usage into `ModelMetadata` and aggregates it on the run
  trace; the result carries a `model` section (provider, model id, prompt
  versions, calls, tokens, latency, cost estimate) that the worker persists
  onto `ai_runs`.
- Policy and guardrail logic remain deterministic Python: the model
  classifies and drafts; it never governs (section 19.3).

### 21.3 Provider Agnosticism And The Scripted Provider

`SUPPORT_LLM_PROVIDER=scripted` selects a dependency-free stand-in chat model
that answers with the deterministic support rules **through the exact same
adapter path** (prompt files → chat-model interface → structured outputs →
usage capture). Because the adapter cannot tell it apart from a real chat
model, the golden + injection suites passing under `scripted` and under a
real provider with only env changes is the provider-agnosticism proof — no
code changes anywhere in the path.

### 21.4 Live Eval Gate

The offline suites always run the deterministic model. The opt-in live gate
(costs real tokens; never part of `pnpm test:py`):

```
SUPPORT_LLM_PROVIDER=anthropic SUPPORT_LLM_MODEL=claude-sonnet-5 \
  ANTHROPIC_API_KEY=... PYTHONPATH=ai \
  uv run --frozen --project ai --extra llm python -m evals.live_runner
```

Runs the golden dataset and the full injection suite against the configured
provider with the unchanged hard-fail gates (zero unsafe auto-send, zero
cross-tenant leaks, injection pass rate 1.0) and exits non-zero on any
violation. The same command with `SUPPORT_LLM_PROVIDER=scripted` runs
offline. Dependencies: `uv sync --project ai --extra llm` (LangChain +
`langchain-anthropic`/`langchain-openai`; the sidecar image ships them).

The end-to-end acceptance drive is the sidecar e2e's real-model mode:
`E2E_AI_REAL_PROVIDER=anthropic E2E_AI_REAL_MODEL=claude-sonnet-5` (plus the
provider key) on `pnpm --filter @support/workers test:e2e:service` proves a
real, citation-grounded model draft lands in the approval with real
token/cost provenance persisted on `ai_runs`. Recorded pass (2026-07-07):
both models clear every hard-fail gate — `claude-sonnet-5` (pilot default:
golden topic 0.960/routing 1.0, injection 1.0) and `claude-opus-4-8`
(config-only upgrade; slightly more conservative routing).
