"""Top-level entry point for one AI run.

``run_support_graph`` is what a Temporal activity / backend API calls. It
validates the request, runs the graph with the supplied (or default
deterministic) adapters, assembles the structured :class:`RuntimeResult`, and
converts any input/output validation failure into a structured ``failed`` result
that routes the ticket to a human (harness section 16 — never silently emit
fallback content after an error).
"""

from __future__ import annotations

from typing import Optional

from .deps import GraphDependencies
from .providers import DeterministicSupportModel, ModelProvider
from .retrieval import InMemoryRetrieval, RetrievalPort
from .schemas import (
    FinalRecommendation,
    RuntimeRequest,
    RuntimeResult,
    RuntimeValidationError,
)
from .state import AgentState
from .support_graph import build_support_graph
from .tools import InMemoryToolExecutor, ToolExecutor
from .tracing import RunTrace, deterministic_id


def _default_deps(request: RuntimeRequest, trace: RunTrace) -> GraphDependencies:
    retrieval = InMemoryRetrieval([])
    return GraphDependencies(
        model=DeterministicSupportModel(),
        retrieval=retrieval,
        tool_executor=InMemoryToolExecutor({}, retrieval),
        trace=trace,
    )


def run_support_graph(
    request: RuntimeRequest,
    *,
    model: Optional[ModelProvider] = None,
    retrieval: Optional[RetrievalPort] = None,
    tool_executor: Optional[ToolExecutor] = None,
    trace: Optional[RunTrace] = None,
) -> tuple[RuntimeResult, RunTrace]:
    """Run the support graph and return ``(result, trace)``."""

    ai_run_id = deterministic_id("air", request.tenant_id, request.ticket_id, request.correlation_id)
    trace_id = deterministic_id("trace", request.correlation_id, request.ticket_id)
    if trace is None:
        trace = RunTrace(
            ai_run_id=ai_run_id,
            trace_id=trace_id,
            tenant_id=request.tenant_id,
            ticket_id=request.ticket_id,
        )

    # Validate input (harness section 3). Structural failure → route to human.
    try:
        request.validate()
    except RuntimeValidationError as exc:
        return (
            RuntimeResult(
                status="failed",
                ai_run_id=None,
                trace_id=trace_id,
                error_code="INPUT_VALIDATION_FAILED",
                error_message=str(exc),
                retryable=False,
                reason_codes=("input_invalid", "route_to_human"),
                eval_signals={"stage": "input_validation"},
            ),
            trace,
        )

    if model is None or retrieval is None or tool_executor is None:
        defaults = _default_deps(request, trace)
        deps = GraphDependencies(
            model=model or defaults.model,
            retrieval=retrieval or defaults.retrieval,
            tool_executor=tool_executor or defaults.tool_executor,
            trace=trace,
        )
    else:
        deps = GraphDependencies(model=model, retrieval=retrieval, tool_executor=tool_executor, trace=trace)

    state = AgentState(request=request, ai_run_id=ai_run_id, trace_id=trace_id)

    try:
        compiled = build_support_graph(deps)
        compiled.invoke(state, trace)
        result = _assemble_result(state)
    except Exception as exc:  # any node/output failure → structured failure
        return (
            RuntimeResult(
                status="failed",
                ai_run_id=ai_run_id,
                trace_id=trace_id,
                error_code="AI_RUNTIME_ERROR",
                error_message=f"{type(exc).__name__}: {exc}",
                retryable=False,
                reason_codes=("runtime_error", "route_to_human"),
                eval_signals={"stage": "graph_execution"},
            ),
            trace,
        )

    return result, trace


def _assemble_result(state: AgentState) -> RuntimeResult:
    classification = state.classification
    guardrail = state.guardrail_result
    assert classification is not None and guardrail is not None

    final = FinalRecommendation(
        automation_mode=state.final_automation_mode,
        risk_level=state.final_risk_level,
        confidence=state.final_confidence,
        reason_codes=state.reason_codes,
    )
    final.validate()  # output validation (harness section 4)

    assigned_queue = "human_only_queue" if state.final_automation_mode == "human_only" else None
    routing_decision = {
        "topic": classification.topic,
        "subtopic": classification.subtopic,
        "language": classification.language,
        "sentiment": classification.sentiment,
        "urgency": classification.urgency,
        "priority": classification.priority,
        "risk_level": state.final_risk_level,
        "confidence": state.final_confidence,
        "automation_mode": state.final_automation_mode,
        "assigned_queue": assigned_queue,
        "reason_codes": list(state.reason_codes),
        "required_tools": [call.tool_name for call in state.tool_plan],
        "required_evidence": [e.ref_id for e in state.retrieved_evidence],
    }

    return RuntimeResult(
        status="succeeded",
        ai_run_id=state.ai_run_id,
        trace_id=state.trace_id,
        classification=classification.to_dict(),
        routing_decision=routing_decision,
        tool_calls=tuple(r.to_dict() for r in state.tool_results),
        draft=state.draft.to_dict() if state.draft is not None else None,
        guardrails=guardrail.to_dict(),
        final_recommendation=final.to_dict(),
        approval_package=state.approval_package.to_dict() if state.approval_package else None,
        eval_signals=state.eval_signals,
    )
