"""The support graph nodes (harness section 6).

Each node is a plain function ``(state, deps) -> None`` that reads the fields it
needs from :class:`~runtime.state.AgentState` and writes back the fields it
produces. :mod:`runtime.support_graph` binds these to the graph engine as
closures. Model reasoning (classification, drafting) goes through the
:class:`ModelProvider` port; policy and guardrail logic is deterministic
governance in Python (safety rules must not be probabilistic).
"""

from __future__ import annotations

import re
from typing import Optional

from .deps import GraphDependencies
from .providers import PROMPT_CLASSIFIER, PROMPT_COMPOSER, ModelRequest
from .schemas import (
    Classification,
    Draft,
    DraftEvidence,
    GuardrailIssue,
    GuardrailResult,
    HumanApprovalPackage,
    PolicyDecision,
    RetrievalQuery,
    ToolCallRequest,
    highest_risk,
    most_restrictive_mode,
)
from .state import AgentState
from .tools import ToolExecutionContext, permission_for_tool

# Tools each topic is allowed to use (read-only V1 tools only).
_TOPIC_TOOLS: dict[str, tuple[str, ...]] = {
    "order_status": ("order_lookup", "shipment_tracking_lookup"),
    "refund": ("order_lookup", "refund_eligibility", "kb_search"),
    "cancellation": ("order_lookup", "cancellation_eligibility", "kb_search"),
    "shipping_delay": ("order_lookup", "shipment_tracking_lookup"),
    "missing_package": ("order_lookup", "shipment_tracking_lookup"),
    "faq": ("kb_search",),
    "product_question": ("kb_search",),
    "billing": ("order_lookup", "customer_profile_lookup", "kb_search"),
    "technical_issue": ("kb_search",),
    "legal_or_chargeback": ("order_lookup", "customer_profile_lookup", "kb_search"),
    "fraud_or_abuse": ("customer_profile_lookup", "kb_search"),
    "unknown": ("kb_search",),
}

# Topics whose answer depends on tenant policy evidence.
_POLICY_DEPENDENT = ("refund", "cancellation", "legal_or_chargeback", "billing")

_CONFIDENCE_FLOOR = 0.6

_HASH_ORDER = re.compile(r"#([a-z0-9-]*\d[a-z0-9-]*)", re.I)
_ORDER_KW = re.compile(r"order\s*(?:number|no\.?|#|id)?\s*[:#-]?\s*([a-z0-9-]*\d[a-z0-9-]*)", re.I)
# Bare order id: a short letter prefix followed by 3+ digits (e.g. "A1001").
_BARE_ORDER = re.compile(r"\b([a-z]{1,4}\d{3,}[a-z0-9-]*)\b", re.I)
_TAG_RE = re.compile(r"<[^>]+>")

_UNSAFE_REFUND_PHRASES = (
    "refund has been processed",
    "you will receive a refund",
    "your refund is on the way",
    "i've issued your refund",
    "i have refunded",
    "your money has been refunded",
    "refund of $",
)
_UNSAFE_CANCEL_PHRASES = (
    "order has been canceled",
    "order has been cancelled",
    "i've canceled your order",
    "i have cancelled your order",
)


def _strip_html(text: str) -> str:
    return _TAG_RE.sub("", text)


def extract_order_number(text: str) -> Optional[str]:
    """Extract an order number from customer text, or ``None``. Never guesses
    (harness section 6.6): only returns a token that contains a digit."""

    match = _HASH_ORDER.search(text) or _ORDER_KW.search(text) or _BARE_ORDER.search(text)
    return match.group(1) if match else None


# --- 6.1 Normalize input -----------------------------------------------------


def normalize_node(state: AgentState, deps: GraphDependencies) -> None:
    request = state.request
    customer_messages = [m for m in request.messages if m.role == "customer" and not m.is_internal]
    normalized = tuple(_strip_html(m.content).strip() for m in customer_messages)
    latest = request.latest_customer_message()

    warnings: list[str] = []
    if len(customer_messages) > 20:
        # Trim old history; keep the most recent turns (harness section 3).
        normalized = normalized[-20:]
        warnings.append("history_trimmed")

    state.normalized_messages = normalized
    state.latest_customer_ask = _strip_html(latest.content).strip() if latest else ""
    state.input_warnings = tuple(warnings)


# --- 6.2 Classifier ----------------------------------------------------------


def classifier_node(state: AgentState, deps: GraphDependencies) -> None:
    text = "\n".join(state.normalized_messages) or state.latest_customer_ask
    response = deps.model.invoke(
        ModelRequest(
            prompt_id=PROMPT_CLASSIFIER,
            prompt_version="v1",
            input={"text": text, "customer_tier": state.request.customer.tier},
        )
    )
    deps.trace.record_prompt(PROMPT_CLASSIFIER, "v1")
    deps.trace.record_model(response.metadata.model_id)

    out = response.output
    classification = Classification(
        topic=out["topic"],
        subtopic=out.get("subtopic"),
        language=out.get("language", "en"),
        sentiment=out["sentiment"],
        urgency=out["urgency"],
        priority=out["priority"],
        sensitive_flags=tuple(out.get("sensitive_flags", ())),
        confidence=float(out["confidence"]),
        reasoning_summary=out.get("reasoning_summary", ""),
    )
    classification.validate()
    state.classification = classification
    state.add_reason_codes(f"topic_{classification.topic}")
    for flag in classification.sensitive_flags:
        state.add_reason_codes(f"sensitive_{flag}")


# --- 6.3 Retrieval planner ---------------------------------------------------


def retrieval_planner_node(state: AgentState, deps: GraphDependencies) -> None:
    classification = state.classification
    assert classification is not None
    topic = classification.topic
    queries: list[RetrievalQuery] = []

    if topic in _POLICY_DEPENDENT:
        queries.append(
            RetrievalQuery(query=f"{topic} policy", document_type="policy", reason="policy_dependent_reply")
        )
    if topic in ("faq", "product_question", "technical_issue", "unknown"):
        queries.append(RetrievalQuery(query=state.latest_customer_ask, reason="faq_like"))
    # Always include a general query grounded in the customer ask.
    if state.latest_customer_ask:
        queries.append(RetrievalQuery(query=state.latest_customer_ask, reason="general"))

    state.retrieval_queries = tuple(queries)


# --- 6.4 Retrieval -----------------------------------------------------------


def retrieval_node(state: AgentState, deps: GraphDependencies) -> None:
    limit = state.request.options.max_retrieved_chunks
    collected: dict[str, object] = {}
    try:
        for query in state.retrieval_queries:
            for evidence in deps.retrieval.search(state.request.tenant_id, query, limit=limit):
                # Dedupe by ref, keeping the highest score seen.
                existing = collected.get(evidence.ref_id)
                if existing is None or evidence.relevance_score > existing.relevance_score:  # type: ignore[attr-defined]
                    collected[evidence.ref_id] = evidence
    except Exception as exc:  # retrieval failure routes to human (harness 6.4)
        state.record_error("RETRIEVAL_FAILED", str(exc), retryable=True)
        state.retrieved_evidence = ()
        return

    ordered = sorted(collected.values(), key=lambda e: -e.relevance_score)[:limit]  # type: ignore[attr-defined]
    state.retrieved_evidence = tuple(ordered)  # type: ignore[arg-type]
    for evidence in state.retrieved_evidence:
        deps.trace.record_evidence(evidence.evidence_id)


# --- 6.5 Policy decision -----------------------------------------------------


def policy_node(state: AgentState, deps: GraphDependencies) -> None:
    classification = state.classification
    assert classification is not None
    topic = classification.topic
    flags = classification.sensitive_flags
    reason_codes: list[str] = []

    allowed = _TOPIC_TOOLS.get(topic, ("kb_search",))
    automation_mode = "human_approve"
    risk_level = "low"

    if classification.has_hard_sensitive_flag():
        automation_mode = "human_only"
        risk_level = "high"
        for flag in flags:
            if flag in ("legal_threat", "chargeback", "fraud_suspicion", "safety_issue", "prompt_injection"):
                reason_codes.append(f"{flag}_human_only")
    elif topic in ("refund", "cancellation"):
        risk_level = "medium"
        reason_codes.append(f"{topic}_topic")
    if "vip_customer" in flags:
        automation_mode = most_restrictive_mode(automation_mode, "human_approve")
        reason_codes.append("vip_default_human_approve")

    # Auto-send is opt-in per tenant + topic, low-risk only (harness section 7.1).
    options = state.request.options
    policy_ctx = state.request.policy
    if (
        options.allow_auto_send
        and topic in policy_ctx.auto_send_allowed_topics
        and topic in ("faq", "order_status")
        and not classification.sensitive_flags  # any flag (incl. VIP) blocks auto-send
        and risk_level == "low"
    ):
        automation_mode = "auto_send"
        reason_codes.append("auto_send_allowlisted")
    else:
        reason_codes.append("v1_default_human_approval")

    decision = PolicyDecision(
        automation_mode=automation_mode,
        allowed_tool_names=tuple(allowed),
        blocked_tool_names=(),
        requires_human_approval=automation_mode != "auto_send",
        risk_level=risk_level,
        reason_codes=tuple(dict.fromkeys(reason_codes)),
    )
    decision.validate()
    state.policy_decision = decision
    state.add_reason_codes(*decision.reason_codes)


# --- 6.6 Tool planner --------------------------------------------------------


def tool_planner_node(state: AgentState, deps: GraphDependencies) -> None:
    policy = state.policy_decision
    classification = state.classification
    assert policy is not None and classification is not None

    order_number = extract_order_number("\n".join(state.normalized_messages))
    plan: list[ToolCallRequest] = []

    for tool_name in policy.allowed_tool_names:
        if tool_name in ("order_lookup", "refund_eligibility", "cancellation_eligibility"):
            if order_number is None:
                # Do not guess an order id (harness section 6.6).
                state.add_reason_codes("missing_order_number")
                continue
            plan.append(ToolCallRequest(tool_name=tool_name, arguments={"order_number": order_number}))
        elif tool_name == "shipment_tracking_lookup":
            if order_number is None:
                state.add_reason_codes("missing_order_number")
                continue
            plan.append(ToolCallRequest(tool_name=tool_name, arguments={"order_number": order_number}))
        elif tool_name == "customer_profile_lookup":
            customer = state.request.customer
            if customer.customer_id:
                plan.append(ToolCallRequest(tool_name=tool_name, arguments={"customer_id": customer.customer_id}))
            elif customer.email:
                plan.append(ToolCallRequest(tool_name=tool_name, arguments={"email": customer.email}))
        elif tool_name == "kb_search":
            query = f"{classification.topic} {state.latest_customer_ask}".strip()
            plan.append(ToolCallRequest(tool_name=tool_name, arguments={"query": query}))

    # Respect the per-run tool-call ceiling.
    max_calls = state.request.options.max_tool_calls
    if len(plan) > max_calls:
        plan = plan[:max_calls]
    state.tool_plan = tuple(plan)


# --- 6.7 Tool execution ------------------------------------------------------


def tool_execution_node(state: AgentState, deps: GraphDependencies) -> None:
    policy = state.policy_decision
    assert policy is not None
    granted = frozenset(permission_for_tool(name) for name in policy.allowed_tool_names)
    context = ToolExecutionContext(
        tenant_id=state.request.tenant_id,
        ticket_id=state.request.ticket_id,
        ai_run_id=state.ai_run_id,
        granted_permissions=granted,
    )

    results = []
    for call in state.tool_plan:
        result = deps.tool_executor.execute(call, context)
        result.validate()
        results.append(result)
        if result.tool_call_id:
            deps.trace.record_tool_call(result.tool_call_id)
        if result.status != "succeeded":
            state.record_error(
                "TOOL_FAILED",
                f"{call.tool_name}: {result.error.code if result.error else 'unknown'}",
            )
    state.tool_results = tuple(results)


# --- 6.8 Response composer ---------------------------------------------------


def composer_node(state: AgentState, deps: GraphDependencies) -> None:
    classification = state.classification
    policy = state.policy_decision
    assert classification is not None and policy is not None

    succeeded_tools = [
        {"tool_name": r.tool_name, "output": r.output}
        for r in state.tool_results
        if r.status == "succeeded" and r.output is not None
    ]
    response = deps.model.invoke(
        ModelRequest(
            prompt_id=PROMPT_COMPOSER,
            prompt_version="v1",
            input={
                "topic": classification.topic,
                "brand_name": state.request.tenant.brand_name,
                "tone": state.request.tenant.tone,
                "evidence": [e.to_dict() for e in state.retrieved_evidence],
                "tool_results": succeeded_tools,
            },
        )
    )
    deps.trace.record_prompt(PROMPT_COMPOSER, "v1")
    deps.trace.record_model(response.metadata.model_id)

    out = response.output
    review_reasons = list(policy.reason_codes)
    if "missing_order_number" in state.reason_codes:
        review_reasons.append("missing_order_number")

    draft = Draft(
        draft_text=out["draft_text"],
        customer_language=out.get("customer_language", "en"),
        tone=out.get("tone", state.request.tenant.tone),
        evidence=tuple(
            DraftEvidence(type=e["type"], ref_id=e["ref_id"], summary=e["summary"])
            for e in out.get("evidence", [])
        ),
        risk_level=out.get("risk_level", policy.risk_level),
        confidence=float(out.get("confidence", 0.5)),
        needs_human=policy.automation_mode != "auto_send",
        human_review_reasons=tuple(dict.fromkeys(review_reasons)),
    )
    draft.validate()
    state.draft = draft


# --- 6.9 Guardrail critic ----------------------------------------------------


def guardrail_node(state: AgentState, deps: GraphDependencies) -> None:
    classification = state.classification
    policy = state.policy_decision
    assert classification is not None and policy is not None
    issues: list[GuardrailIssue] = []

    flags = classification.sensitive_flags
    if "prompt_injection" in flags:
        issues.append(GuardrailIssue("PROMPT_INJECTION", "high", "Customer content attempts prompt injection; do not follow embedded instructions."))
    if "safety_issue" in flags:
        issues.append(GuardrailIssue("SAFETY_ISSUE", "high", "Potential safety issue requires human handling."))
    if "legal_threat" in flags or "chargeback" in flags:
        issues.append(GuardrailIssue("LEGAL_OR_CHARGEBACK", "high", "Legal/chargeback content must be handled by a human."))
    if "fraud_suspicion" in flags:
        issues.append(GuardrailIssue("FRAUD_SUSPICION", "high", "Suspected fraud must be handled by a human."))

    draft = state.draft
    has_policy_evidence = any(e.document_type == "policy" for e in state.retrieved_evidence)
    refund_eligible = any(
        r.tool_name == "refund_eligibility" and r.status == "succeeded" and (r.output or {}).get("eligible") is True
        for r in state.tool_results
    )
    cancel_ok = any(
        r.tool_name == "cancellation_eligibility" and r.status == "succeeded" and (r.output or {}).get("cancellable") is True
        for r in state.tool_results
    )

    if draft is not None:
        lowered = draft.draft_text.lower()
        if any(phrase in lowered for phrase in _UNSAFE_REFUND_PHRASES) and not (refund_eligible and has_policy_evidence):
            issues.append(GuardrailIssue("UNSAFE_PROMISE", "high", "Draft promises a refund without eligibility + policy evidence."))
        if any(phrase in lowered for phrase in _UNSAFE_CANCEL_PHRASES) and not cancel_ok:
            issues.append(GuardrailIssue("UNSAFE_PROMISE", "high", "Draft confirms a cancellation without eligibility evidence."))
        if classification.topic == "refund" and not has_policy_evidence and not refund_eligible:
            issues.append(GuardrailIssue("MISSING_POLICY_EVIDENCE", "medium", "Refund answer lacks active policy citation or eligibility evidence."))

    if any(err["code"] == "RETRIEVAL_FAILED" for err in state.errors):
        issues.append(GuardrailIssue("RETRIEVAL_FAILED", "medium", "Evidence retrieval failed; answer may be ungrounded."))
    if any(err["code"] == "TOOL_FAILED" for err in state.errors):
        issues.append(GuardrailIssue("TOOL_FAILED", "medium", "A planned tool call failed; surface to human approval."))
    if "missing_order_number" in state.reason_codes and classification.topic in (
        "order_status", "refund", "cancellation", "shipping_delay", "missing_package"
    ):
        issues.append(GuardrailIssue("MISSING_INFO", "medium", "Order number is required but was not provided."))

    if any(i.severity == "high" for i in issues):
        recommended = "human_only"
        risk = "high"
    elif any(i.severity == "medium" for i in issues):
        recommended = "human_approve"
        risk = "medium"
    else:
        recommended = "auto_send"  # guardrail is satisfied; policy still governs
        risk = "low"

    result = GuardrailResult(
        passed=len(issues) == 0,
        risk_level=risk,
        issues=tuple(issues),
        recommended_action=recommended,
    )
    result.validate()
    state.guardrail_result = result
    deps.trace.guardrail_result = result.to_dict()


# --- 6.10 Escalation + final recommendation ----------------------------------


def escalation_node(state: AgentState, deps: GraphDependencies) -> None:
    classification = state.classification
    policy = state.policy_decision
    guardrail = state.guardrail_result
    assert classification is not None and policy is not None and guardrail is not None

    # Critic can only downgrade automation, never upgrade beyond policy.
    final_mode = most_restrictive_mode(policy.automation_mode, guardrail.recommended_action)

    draft_conf = state.draft.confidence if state.draft is not None else classification.confidence
    confidence = min(classification.confidence, draft_conf)
    if confidence < _CONFIDENCE_FLOOR:
        final_mode = most_restrictive_mode(final_mode, "human_approve")
        state.add_reason_codes("low_confidence")

    has_evidence = len(state.retrieved_evidence) > 0
    has_tool_success = any(r.status == "succeeded" for r in state.tool_results)

    # No customer-facing response is produced without evidence: auto-send always
    # requires grounding (retrieved evidence or a successful tool call).
    if final_mode == "auto_send" and not (has_evidence or has_tool_success):
        final_mode = most_restrictive_mode(final_mode, "human_approve")
        state.add_reason_codes("no_evidence_no_autosend")

    # Safety net: any sensitive flag (VIP, privacy, abusive, ...) blocks auto-send.
    if final_mode == "auto_send" and classification.sensitive_flags:
        final_mode = most_restrictive_mode(final_mode, "human_approve")
        state.add_reason_codes("sensitive_no_autosend")

    # A policy-dependent topic with no evidence and no successful tool cannot be
    # auto-answered.
    if classification.topic in _POLICY_DEPENDENT and not has_evidence and not has_tool_success:
        final_mode = most_restrictive_mode(final_mode, "human_approve")
        state.add_reason_codes("insufficient_evidence")

    state.final_automation_mode = final_mode
    state.final_risk_level = highest_risk(policy.risk_level, guardrail.risk_level)
    state.final_confidence = round(confidence, 4)

    if final_mode != "auto_send":
        state.approval_package = _build_approval_package(state)


def _build_approval_package(state: AgentState) -> HumanApprovalPackage:
    classification = state.classification
    assert classification is not None
    missing_questions: list[str] = []
    if "missing_order_number" in state.reason_codes:
        missing_questions.append("Could you share your order number so we can look into this?")

    risk_reasons = [
        err["code"] for err in state.errors
    ] + [issue.code for issue in (state.guardrail_result.issues if state.guardrail_result else ())]

    return HumanApprovalPackage(
        customer_message=state.latest_customer_ask,
        ticket_summary=f"{classification.topic} / {classification.sentiment} / priority {classification.priority}",
        classification=classification.to_dict(),
        draft_text=state.draft.draft_text if state.draft else None,
        evidence=[e.to_dict() for e in state.retrieved_evidence],
        tool_results=[r.to_dict() for r in state.tool_results],
        risk_reasons=list(dict.fromkeys(risk_reasons)),
        suggested_action=state.final_automation_mode,
        missing_info_questions=missing_questions,
    )


def finalize_node(state: AgentState, deps: GraphDependencies) -> None:
    classification = state.classification
    guardrail = state.guardrail_result
    assert classification is not None and guardrail is not None

    escalated = state.final_automation_mode != "auto_send"
    tools_called = [r.tool_name for r in state.tool_results]
    state.eval_signals = {
        "topic": classification.topic,
        "priority": classification.priority,
        "sentiment": classification.sentiment,
        "automation_mode": state.final_automation_mode,
        "risk_level": state.final_risk_level,
        "confidence": state.final_confidence,
        "escalated": escalated,
        "sensitive_flags": list(classification.sensitive_flags),
        "prompt_injection_flagged": "prompt_injection" in classification.sensitive_flags,
        "guardrail_passed": guardrail.passed,
        "tools_called": tools_called,
        "successful_tools": [r.tool_name for r in state.tool_results if r.status == "succeeded"],
        "evidence_count": len(state.retrieved_evidence),
        "has_draft": state.draft is not None,
        "errors": [err["code"] for err in state.errors],
    }
    deps.trace.final_recommendation = {
        "automation_mode": state.final_automation_mode,
        "risk_level": state.final_risk_level,
        "confidence": state.final_confidence,
        "reason_codes": list(state.reason_codes),
    }


def route_after_tools(state: AgentState) -> str:
    """Conditional edge: skip drafting for hard human-only cases (a human writes
    legal/chargeback/fraud/safety/injection replies)."""

    classification = state.classification
    policy = state.policy_decision
    if (
        classification is not None
        and classification.has_hard_sensitive_flag()
        and policy is not None
        and policy.automation_mode == "human_only"
    ):
        return "skip"
    return "compose"
