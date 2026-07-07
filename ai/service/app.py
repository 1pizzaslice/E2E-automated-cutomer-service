"""FastAPI sidecar exposing the support graph as ``POST /internal/ai/run``.

This is the ONLY fastapi import site in the service package (install with
``uv sync --extra service``). HTTP status codes are reserved for the transport
contract — 401 auth, 400 malformed/contract-violating body, 500 unexpected —
while a *failed run* is a valid domain outcome and returns 200 with the
structured ``RuntimeResult`` (harness section 16: a failure routes the ticket
to a human, it is not an HTTP error the caller should retry blindly).
"""

from __future__ import annotations

import hmac
import time
from typing import Any, Callable, Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from runtime.llm import build_model_provider
from runtime.runner import run_support_graph
from runtime.schemas import RuntimeRequest, RuntimeValidationError
from runtime.tracing import GRAPH_VERSION

from .adapters import HttpRetrieval, HttpToolExecutor
from .config import ServiceConfig, load_service_config
from .logs import create_service_logger, log_event
from .request_parsing import parse_runtime_request

# (model, retrieval, tool_executor) — retrieval/tool_executor may be None to let
# run_support_graph fall back to its in-memory defaults.
PortsFactory = Callable[[RuntimeRequest], tuple[Any, Any, Any]]


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": {"code": code, "message": message}})


def create_app(
    config: Optional[ServiceConfig] = None,
    *,
    ports_factory: Optional[PortsFactory] = None,
) -> FastAPI:
    if config is None:
        config = load_service_config()
    logger = create_service_logger(config.environment)

    # The model provider is resolved once at startup (Milestone 15): the
    # deterministic offline model unless SUPPORT_LLM_PROVIDER selects a real
    # (or scripted) provider. Chat-model clients are reusable across requests;
    # a per-request ports_factory (tests, eval parity) still takes precedence.
    model_provider = build_model_provider(config.llm)

    app = FastAPI(title="ai-runtime", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "ai-runtime",
            "mode": config.mode,
            "graph_version": GRAPH_VERSION,
            "model_provider": config.llm.provider or "deterministic",
        }

    @app.post("/internal/ai/run")
    async def run(request: Request) -> JSONResponse:
        started = time.monotonic()
        header_correlation_id = request.headers.get("x-correlation-id")

        supplied = request.headers.get("authorization") or ""
        expected = f"Bearer {config.token}"
        if not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
            log_event(
                logger,
                "warning",
                "ai run rejected",
                correlation_id=header_correlation_id,
                status="rejected",
                error_code="AUTH_REQUIRED",
            )
            return _error_response(401, "AUTH_REQUIRED", "A valid bearer token is required.")

        try:
            payload = await request.json()
        except Exception:
            log_event(
                logger,
                "warning",
                "ai run rejected",
                correlation_id=header_correlation_id,
                status="rejected",
                error_code="VALIDATION_ERROR",
            )
            return _error_response(400, "VALIDATION_ERROR", "request body must be valid JSON")

        try:
            runtime_request = parse_runtime_request(payload)
        except RuntimeValidationError as exc:
            log_event(
                logger,
                "warning",
                "ai run rejected",
                correlation_id=header_correlation_id,
                status="rejected",
                error_code="VALIDATION_ERROR",
            )
            return _error_response(400, "VALIDATION_ERROR", str(exc))

        try:
            if ports_factory is not None:
                model, retrieval, tool_executor = ports_factory(runtime_request)
            elif config.mode == "service":
                model = model_provider
                retrieval = HttpRetrieval(
                    config.api_base_url,
                    config.api_token,
                    correlation_id=runtime_request.correlation_id,
                    timeout_s=config.http_timeout_s,
                    logger=logger,
                )
                tool_executor = HttpToolExecutor(
                    config.api_base_url,
                    config.api_token,
                    correlation_id=runtime_request.correlation_id,
                    timeout_s=config.http_timeout_s,
                    logger=logger,
                )
            else:  # local mode: run_support_graph uses its in-memory defaults
                model = model_provider
                retrieval = None
                tool_executor = None

            # run_support_graph never raises; failures come back structured.
            result, _trace = run_support_graph(
                runtime_request,
                model=model,
                retrieval=retrieval,
                tool_executor=tool_executor,
            )
            body = result.to_dict()
        except Exception as exc:  # should be unreachable
            log_event(
                logger,
                "error",
                "ai run crashed",
                correlation_id=runtime_request.correlation_id,
                tenant_id=runtime_request.tenant_id,
                ticket_id=runtime_request.ticket_id,
                status="error",
                error_code="INTERNAL_ERROR",
                duration_ms=int((time.monotonic() - started) * 1000),
                exception_type=type(exc).__name__,
            )
            return _error_response(500, "INTERNAL_ERROR", "unexpected error while running the graph")

        log_event(
            logger,
            "info" if result.status == "succeeded" else "warning",
            "ai run completed",
            correlation_id=runtime_request.correlation_id,
            trace_id=result.trace_id,
            tenant_id=runtime_request.tenant_id,
            ticket_id=runtime_request.ticket_id,
            ai_run_id=result.ai_run_id,
            status=result.status,
            error_code=result.error_code if result.status == "failed" else None,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        return JSONResponse(status_code=200, content=body)

    return app
