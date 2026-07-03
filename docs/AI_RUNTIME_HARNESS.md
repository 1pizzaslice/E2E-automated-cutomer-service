# AI Runtime Harness

## Purpose

This document defines the backend AI runtime architecture: LangGraph graph design, model calls, prompts, tools, guardrails, evals, traces, and the rules that keep AI useful without letting it become uncontrolled business logic.

The AI runtime is a Python service called by Temporal activities or backend APIs. It returns structured outputs. It does not own durable ticket state and does not send messages directly to customers.

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

LangGraph owns:

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

Current backend placeholder:

- `packages/workers/src/workflows/ticket-lifecycle-types.ts` defines `RunAiGraphActivityInput` and `RunAiGraphActivityResult` for the Temporal workflow boundary.
- Successful results include `classification`, `routing_decision`, `tool_calls`, optional `draft`, `guardrails`, `final_recommendation`, eval signals, and trace identifiers.
- Structured failures return `status: "failed"`, an error code/message, retryability, reason codes, eval signals, and optional run/trace IDs; `ticketLifecycleWorkflow` audits the failure and routes the ticket to human approval.
- The placeholder does not call LangGraph yet. Real Python runtime calls, Pydantic validation, prompt/tool execution, and trace export remain future AI runtime work behind the activity boundary.

## 5. LangGraph State

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

Prompt files should eventually live in the AI runtime package with stable IDs.

Prompt ID format:

- `support_classifier.v1`
- `support_retrieval_planner.v1`
- `support_policy_decider.v1`
- `support_tool_planner.v1`
- `support_response_composer.v1`
- `support_guardrail_critic.v1`

Prompt changes require:

- Version increment if behavior changes materially.
- Eval run against golden dataset.
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
`support_response_composer.v1` (section 8); versioned prompt files land when a
real model provider is wired.
