"""Eval-parity harness: prove service-path runs match in-process runs.

For every golden case this runs the support graph twice with the SAME fixture
ports (exactly as ``evals/runner.py`` builds them):

1. in-process via ``run_support_graph``,
2. through the FastAPI service path (``POST /internal/ai/run`` over fastapi's
   in-process TestClient, real auth + wire parsing),

and asserts the two ``RuntimeResult`` dicts serialize to byte-identical
canonical JSON. It then re-runs the full eval report with every case routed
through the service and asserts the hard-fail gates still pass.

Run from the repo root:

    PYTHONPATH=ai uv run --frozen --project ai --extra service \
        python -m service.eval_parity

Requires the ``service`` uv extra (fastapi + httpx).
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

from evals.fixtures import build_environment
from evals.golden_dataset import GOLDEN_CASES, EvalCase
from evals.runner import EvalReport, _build_request, run_eval
from runtime.providers import DeterministicSupportModel
from runtime.runner import run_support_graph
from runtime.schemas import RuntimeRequest, RuntimeResult

from .config import ServiceConfig

EVAL_PARITY_TOKEN = "eval-parity-token"


def request_to_wire(request: RuntimeRequest) -> dict[str, Any]:
    """Serialize a RuntimeRequest to the AiRuntimeRunRequestSchema wire shape."""

    return {
        "tenant_id": request.tenant_id,
        "ticket_id": request.ticket_id,
        "conversation_id": request.conversation_id,
        "correlation_id": request.correlation_id,
        "messages": [
            {"role": m.role, "content": m.content, "is_internal": m.is_internal}
            for m in request.messages
        ],
        "customer": {
            "customer_id": request.customer.customer_id,
            "email": request.customer.email,
            "display_name": request.customer.display_name,
            "tier": request.customer.tier,
            "locale": request.customer.locale,
        },
        "tenant": {
            "brand_name": request.tenant.brand_name,
            "tone": request.tenant.tone,
            "timezone": request.tenant.timezone,
        },
        "policy": {
            "auto_send_allowed_topics": list(request.policy.auto_send_allowed_topics),
            "active_policy_version_ids": list(request.policy.active_policy_version_ids),
        },
        "options": {
            "allow_auto_send": request.options.allow_auto_send,
            "max_tool_calls": request.options.max_tool_calls,
            "max_retrieved_chunks": request.options.max_retrieved_chunks,
        },
        "ai_run_type": request.ai_run_type,
    }


def result_from_wire(payload: dict[str, Any]) -> RuntimeResult:
    """Rehydrate the service's JSON result into a RuntimeResult."""

    if payload.get("status") == "succeeded":
        return RuntimeResult(
            status="succeeded",
            ai_run_id=payload["ai_run_id"],
            trace_id=payload["trace_id"],
            classification=payload["classification"],
            routing_decision=payload["routing_decision"],
            tool_calls=tuple(payload["tool_calls"]),
            draft=payload["draft"],
            guardrails=payload["guardrails"],
            final_recommendation=payload["final_recommendation"],
            approval_package=payload["approval_package"],
            eval_signals=payload["eval_signals"],
        )
    return RuntimeResult(
        status="failed",
        ai_run_id=payload["ai_run_id"],
        trace_id=payload["trace_id"],
        error_code=payload["error_code"],
        error_message=payload["error_message"],
        retryable=payload["retryable"],
        reason_codes=tuple(payload["reason_codes"]),
        eval_signals=payload["eval_signals"],
    )


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


class ServiceInvoker:
    """Drives ``POST /internal/ai/run`` in-process via fastapi's TestClient.

    The app is created with a ``ports_factory`` that returns whatever ports the
    caller supplied for the current request, so the service path runs with the
    exact same fixture adapters as the in-process comparison run.
    """

    def __init__(self) -> None:
        from fastapi.testclient import TestClient  # requires the service extra

        from .app import create_app

        self._ports: tuple[Any, Any, Any] | None = None
        config = ServiceConfig(
            token=EVAL_PARITY_TOKEN,
            mode="local",
            api_base_url=None,
            api_token=None,
            http_timeout_s=5.0,
            environment="eval",
        )
        app = create_app(config, ports_factory=lambda _request: self._ports)
        # Keep parity output readable: drop per-run info log lines (warnings —
        # rejected requests, failed runs — still surface).
        from .logs import LOGGER_NAME

        logging.getLogger(LOGGER_NAME).setLevel(logging.WARNING)
        self._client = TestClient(app)

    def post_run(self, request: RuntimeRequest, *, model, retrieval, tool_executor) -> dict[str, Any]:
        """Return the raw JSON body of a 200 service run."""

        self._ports = (model, retrieval, tool_executor)
        response = self._client.post(
            "/internal/ai/run",
            json=request_to_wire(request),
            headers={"Authorization": f"Bearer {EVAL_PARITY_TOKEN}"},
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"service returned HTTP {response.status_code}: {response.text}"
            )
        return response.json()

    def invoke(self, request: RuntimeRequest, *, model, retrieval, tool_executor) -> RuntimeResult:
        """`run_eval(invoke=...)`-compatible service-path runner."""

        payload = self.post_run(
            request, model=model, retrieval=retrieval, tool_executor=tool_executor
        )
        return result_from_wire(payload)


def run_parity(cases: tuple[EvalCase, ...] = GOLDEN_CASES) -> list[str]:
    """Return a mismatch description per case whose service-path result is not
    byte-identical to the in-process result (empty list == full parity)."""

    invoker = ServiceInvoker()
    retrieval, tool_executor = build_environment()
    mismatches: list[str] = []
    for case in cases:
        request = _build_request(case)
        in_process, _trace = run_support_graph(
            request,
            model=DeterministicSupportModel(),
            retrieval=retrieval,
            tool_executor=tool_executor,
        )
        service_payload = invoker.post_run(
            request,
            model=DeterministicSupportModel(),
            retrieval=retrieval,
            tool_executor=tool_executor,
        )
        if canonical_json(in_process.to_dict()) != canonical_json(service_payload):
            mismatches.append(f"{case.case_id}: service result differs from in-process result")
    return mismatches


def run_service_eval() -> EvalReport:
    """Run the full golden eval with every case routed through the service."""

    return run_eval(invoke=ServiceInvoker().invoke)


def main() -> int:
    mismatches = run_parity()
    print(
        f"Eval parity: {len(GOLDEN_CASES)} golden cases — "
        f"{'PASS' if not mismatches else 'FAIL'} "
        "(service path vs in-process, byte-identical JSON)"
    )
    for mismatch in mismatches:
        print(f"  - {mismatch}")

    report = run_service_eval()
    print()
    print("Service-path " + report.format())

    return 1 if (mismatches or not report.passed) else 0


if __name__ == "__main__":
    sys.exit(main())
