"""The mutable agent state for one AI run (harness section 5).

State is threaded through the graph nodes. Each node reads the fields it needs
and writes back the fields it produces. The state deliberately holds only
minimized, citation-bearing data: no raw secrets, and tool outputs are reduced
before being stored (harness section 5 rules).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from .schemas import (
    Classification,
    Draft,
    Evidence,
    GuardrailResult,
    HumanApprovalPackage,
    PolicyDecision,
    RetrievalQuery,
    RuntimeRequest,
    ToolCallRequest,
    ToolCallResult,
)


@dataclass
class AgentState:
    """Working state for a single support graph run."""

    request: RuntimeRequest
    ai_run_id: str
    trace_id: str

    # Normalized input.
    latest_customer_ask: str = ""
    normalized_messages: tuple[str, ...] = ()
    input_warnings: tuple[str, ...] = ()

    # Node outputs.
    classification: Optional[Classification] = None
    retrieval_queries: tuple[RetrievalQuery, ...] = ()
    retrieved_evidence: tuple[Evidence, ...] = ()
    policy_decision: Optional[PolicyDecision] = None
    tool_plan: tuple[ToolCallRequest, ...] = ()
    tool_results: tuple[ToolCallResult, ...] = ()
    draft: Optional[Draft] = None
    guardrail_result: Optional[GuardrailResult] = None

    # Final assembly.
    final_automation_mode: str = "human_approve"
    final_risk_level: str = "low"
    final_confidence: float = 0.0
    reason_codes: tuple[str, ...] = ()
    approval_package: Optional[HumanApprovalPackage] = None

    # Structured errors that branch to escalation (harness section 5).
    errors: tuple[dict[str, Any], ...] = ()
    eval_signals: dict[str, Any] = field(default_factory=dict)

    def add_reason_codes(self, *codes: str) -> None:
        """Append reason codes, de-duplicating while preserving order."""

        merged = list(self.reason_codes)
        for code in codes:
            if code not in merged:
                merged.append(code)
        self.reason_codes = tuple(merged)

    def record_error(self, code: str, message: str, *, retryable: bool = False) -> None:
        self.errors = self.errors + (
            {"code": code, "message": message, "retryable": retryable},
        )
