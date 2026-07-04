"""HTTP port adapters: the service-mode ToolExecutor and RetrievalPort.

* :class:`HttpToolExecutor` calls the governed TypeScript tool registry via
  ``POST /internal/tools/execute`` (``InternalToolExecuteRequestSchema`` in →
  Milestone 8 ``ToolCallResult`` envelope out). It NEVER raises: transport
  failures, non-200 statuses, and contract violations all become a *failed*
  ``ToolCallResult`` (code ``tool_error``) so tool failures stay visible but
  non-fatal (harness section 6.7).
* :class:`HttpRetrieval` calls the Milestone 7 ``POST /v1/kb/search`` endpoint
  and maps each hit to a runtime :class:`Evidence`, mirroring
  ``InMemoryRetrieval`` construction exactly (same ``deterministic_id``
  derivation over ``(tenant_id, ref_id, query)``, same policy-vs-kb_chunk type
  rule, same 400-char excerpt truncation). Non-200 / transport / malformed
  responses raise :class:`RetrievalUnavailableError`, which the retrieval node
  converts into a structured failed run that routes to a human.

Both adapters take an injectable ``post`` callable (``service.http.post_json``
signature) so tests exercise them without a network.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from runtime.schemas import (
    Evidence,
    RetrievalQuery,
    ToolCallError,
    ToolCallRequest,
    ToolCallResult,
)
from runtime.tools import ToolExecutionContext
from runtime.tracing import deterministic_id

from .http import HttpJsonResponse, HttpTransportError, post_json
from .logs import ServiceLogger, log_event

# Mirror of KbDocumentTypeSchema in @support/shared-schemas. The runtime's
# retrieval planner only ever emits document_type="policy" (runtime/nodes.py),
# which is in this enum; any other value is omitted from the wire request
# because /v1/kb/search would reject it.
_API_DOCUMENT_TYPES = ("faq", "policy", "macro", "product_doc", "sop")

# Same excerpt bound as InMemoryRetrieval (runtime/retrieval.py).
_EXCERPT_MAX_CHARS = 400

_TOOL_STATUSES = ("succeeded", "failed", "blocked")

PostJson = Callable[..., HttpJsonResponse]


class RetrievalUnavailableError(Exception):
    """KB search could not produce results (transport, non-200, bad contract)."""


class HttpToolExecutor:
    """ToolExecutor implementation over ``POST /internal/tools/execute``."""

    def __init__(
        self,
        api_base_url: str,
        api_token: str,
        *,
        correlation_id: str,
        post: PostJson = post_json,
        timeout_s: float = 5.0,
        logger: Optional[ServiceLogger] = None,
    ) -> None:
        self._url = f"{api_base_url.rstrip('/')}/internal/tools/execute"
        self._api_token = api_token
        self._correlation_id = correlation_id
        self._post = post
        self._timeout_s = timeout_s
        self._logger = logger

    def execute(self, request: ToolCallRequest, context: ToolExecutionContext) -> ToolCallResult:
        try:
            return self._execute(request, context)
        except Exception as exc:  # defensive: tool failures must never crash a run
            return self._failed(request.tool_name, f"tool executor error: {type(exc).__name__}")

    def _execute(self, request: ToolCallRequest, context: ToolExecutionContext) -> ToolCallResult:
        inner: dict[str, Any] = {
            "tool_name": request.tool_name,
            "arguments": request.arguments,
        }
        if request.idempotency_key is not None:
            inner["idempotency_key"] = request.idempotency_key
        body = {
            "tenant_id": context.tenant_id,
            "ticket_id": context.ticket_id,
            "ai_run_id": context.ai_run_id,
            "granted_permissions": sorted(context.granted_permissions),
            "request": inner,
        }
        headers = {
            "Authorization": f"Bearer {self._api_token}",
            "content-type": "application/json",
            "x-correlation-id": self._correlation_id,
        }
        try:
            response = self._post(self._url, headers=headers, body=body, timeout_s=self._timeout_s)
        except HttpTransportError as exc:
            return self._failed(
                request.tool_name, f"tool execution transport failure: {exc}", context=context
            )
        if response.status != 200:
            return self._failed(
                request.tool_name,
                f"tool execution endpoint returned HTTP {response.status}",
                context=context,
            )
        return self._parse_result(request.tool_name, response.body, context)

    def _parse_result(
        self, tool_name: str, payload: Any, context: ToolExecutionContext
    ) -> ToolCallResult:
        try:
            if not isinstance(payload, dict):
                raise ValueError("response body must be a JSON object")
            status = payload.get("status")
            if status not in _TOOL_STATUSES:
                raise ValueError(f"status must be one of {_TOOL_STATUSES}, got {status!r}")
            tool_call_id = payload.get("tool_call_id")
            if not isinstance(tool_call_id, str):
                raise ValueError("tool_call_id must be a string")
            result_tool_name = payload.get("tool_name")
            if not isinstance(result_tool_name, str) or not result_tool_name:
                raise ValueError("tool_name must be a non-empty string")
            side_effect_class = payload.get("side_effect_class")
            if not isinstance(side_effect_class, str):
                raise ValueError("side_effect_class must be a string")
            idempotent_replay = payload.get("idempotent_replay", False)
            if not isinstance(idempotent_replay, bool):
                raise ValueError("idempotent_replay must be a boolean")
            output = payload.get("output")
            if output is not None and not isinstance(output, dict):
                raise ValueError("output must be an object")
            error_payload = payload.get("error")
            error: Optional[ToolCallError] = None
            if error_payload is not None:
                if not isinstance(error_payload, dict):
                    raise ValueError("error must be an object")
                code = error_payload.get("code")
                message = error_payload.get("message")
                if not isinstance(code, str) or not isinstance(message, str):
                    raise ValueError("error.code and error.message must be strings")
                error = ToolCallError(code=code, message=message)
            result = ToolCallResult(
                status=status,
                tool_call_id=tool_call_id,
                tool_name=result_tool_name,
                side_effect_class=side_effect_class,
                idempotent_replay=idempotent_replay,
                output=output,
                error=error,
            )
            result.validate()
            return result
        except Exception as exc:
            return self._failed(
                tool_name, f"invalid tool result envelope: {exc}", context=context
            )

    def _failed(
        self,
        tool_name: str,
        message: str,
        *,
        context: Optional[ToolExecutionContext] = None,
    ) -> ToolCallResult:
        if self._logger is not None:
            log_event(
                self._logger,
                "warning",
                "tool execution failed",
                correlation_id=self._correlation_id,
                tenant_id=context.tenant_id if context else None,
                ticket_id=context.ticket_id if context else None,
                ai_run_id=context.ai_run_id if context else None,
                tool_name=tool_name,
                status="failed",
                error_code="tool_error",
            )
        return ToolCallResult(
            status="failed",
            tool_call_id="",
            tool_name=tool_name,
            side_effect_class="read_only",
            error=ToolCallError(code="tool_error", message=message),
        )


class HttpRetrieval:
    """RetrievalPort implementation over ``POST /v1/kb/search``."""

    def __init__(
        self,
        api_base_url: str,
        api_token: str,
        *,
        correlation_id: str,
        post: PostJson = post_json,
        timeout_s: float = 5.0,
        logger: Optional[ServiceLogger] = None,
    ) -> None:
        self._url = f"{api_base_url.rstrip('/')}/v1/kb/search"
        self._api_token = api_token
        self._correlation_id = correlation_id
        self._post = post
        self._timeout_s = timeout_s
        self._logger = logger

    def search(self, tenant_id: str, query: RetrievalQuery, *, limit: int) -> list[Evidence]:
        if not query.query.strip():
            # Mirror InMemoryRetrieval: an empty query yields no evidence
            # (KbSearchRequestSchema would reject query: "").
            return []

        body: dict[str, Any] = {"query": query.query, "limit": limit}
        if query.document_type in _API_DOCUMENT_TYPES:
            body["document_type"] = query.document_type
        headers = {
            "Authorization": f"Bearer {self._api_token}",
            "content-type": "application/json",
            "x-tenant-id": tenant_id,
            "x-correlation-id": self._correlation_id,
        }
        try:
            response = self._post(self._url, headers=headers, body=body, timeout_s=self._timeout_s)
        except HttpTransportError as exc:
            raise self._unavailable(tenant_id, f"kb search transport failure: {exc}")
        if response.status != 200:
            raise self._unavailable(tenant_id, f"kb search returned HTTP {response.status}")

        payload = response.body
        results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(results, list):
            raise self._unavailable(tenant_id, "kb search response is missing a results array")

        evidence: list[Evidence] = []
        for item in results[:limit]:
            evidence.append(self._to_evidence(tenant_id, query, item))
        return evidence

    def _to_evidence(self, tenant_id: str, query: RetrievalQuery, item: Any) -> Evidence:
        if not isinstance(item, dict):
            raise self._unavailable(tenant_id, "kb search result must be an object")
        kb_chunk_id = item.get("kb_chunk_id")
        content = item.get("content")
        document_title = item.get("document_title")
        document_type = item.get("document_type")
        score = item.get("score")
        if not isinstance(kb_chunk_id, str) or not kb_chunk_id:
            raise self._unavailable(tenant_id, "kb search result is missing kb_chunk_id")
        if not isinstance(content, str):
            raise self._unavailable(tenant_id, "kb search result is missing content")
        if not isinstance(document_title, str) or not isinstance(document_type, str):
            raise self._unavailable(tenant_id, "kb search result is missing citation fields")
        if isinstance(score, bool) or not isinstance(score, (int, float)):
            raise self._unavailable(tenant_id, "kb search result is missing a numeric score")

        # InMemoryRetrieval sources policy_version_id from its document fixture;
        # on the wire it rides in the chunk's ingest-time metadata snapshot.
        metadata = item.get("metadata")
        policy_version_id: Optional[str] = None
        if isinstance(metadata, dict):
            candidate = metadata.get("policy_version_id")
            if isinstance(candidate, str) and candidate:
                policy_version_id = candidate

        return Evidence(
            # Same derivation as InMemoryRetrieval: ("ev", tenant, ref, query),
            # with the chunk id as this port's citation ref.
            evidence_id=deterministic_id("ev", tenant_id, kb_chunk_id, query.query),
            type="policy" if document_type == "policy" else "kb_chunk",
            ref_id=kb_chunk_id,
            document_title=document_title,
            document_type=document_type,
            content_excerpt=content[:_EXCERPT_MAX_CHARS],
            relevance_score=float(score),
            policy_version_id=policy_version_id,
        )

    def _unavailable(self, tenant_id: str, message: str) -> RetrievalUnavailableError:
        if self._logger is not None:
            log_event(
                self._logger,
                "warning",
                "kb retrieval unavailable",
                correlation_id=self._correlation_id,
                tenant_id=tenant_id,
                status="failed",
                error_code="RETRIEVAL_FAILED",
            )
        return RetrievalUnavailableError(message)
