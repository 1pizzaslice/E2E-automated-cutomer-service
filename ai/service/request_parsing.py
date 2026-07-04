"""Strict stdlib parsing of the ``POST /internal/ai/run`` wire request.

This is the Python mirror of ``AiRuntimeRunRequestSchema`` in
``@support/shared-schemas`` (Milestone 14): every object is ``.strict()`` —
unknown keys are rejected at every level — required ids must be non-empty
strings, and optional sub-objects take the runtime dataclass defaults for
omitted fields (AI_RUNTIME_HARNESS section 3). Every failure raises
:class:`RuntimeValidationError` with a precise message; the service turns that
into an HTTP 400 (a contract violation, permanent for the caller). Semantic
input validation (e.g. "at least one customer-visible message") stays in
``RuntimeRequest.validate()`` and yields a structured *failed run*, not a 400.
"""

from __future__ import annotations

from typing import Any

from runtime.schemas import (
    CustomerContext,
    Message,
    PolicyContext,
    RuntimeOptions,
    RuntimeRequest,
    RuntimeValidationError,
    TenantContext,
)

_TOP_LEVEL_KEYS = frozenset(
    {
        "tenant_id",
        "ticket_id",
        "conversation_id",
        "correlation_id",
        "messages",
        "customer",
        "tenant",
        "policy",
        "options",
        "ai_run_type",
    }
)
_MESSAGE_KEYS = frozenset({"role", "content", "is_internal"})
_CUSTOMER_KEYS = frozenset({"customer_id", "email", "display_name", "tier", "locale"})
_TENANT_KEYS = frozenset({"brand_name", "tone", "timezone"})
_POLICY_KEYS = frozenset({"auto_send_allowed_topics", "active_policy_version_ids"})
_OPTIONS_KEYS = frozenset({"allow_auto_send", "max_tool_calls", "max_retrieved_chunks"})

_MESSAGE_ROLES = ("customer", "agent", "system")
_CUSTOMER_TIERS = ("standard", "vip")
# AiRunTypeSchema in @support/shared-schemas.
_AI_RUN_TYPES = ("classification", "routing", "draft", "full_graph", "critique", "eval")


def _fail(message: str) -> None:
    raise RuntimeValidationError(message)


def _check_object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(f"{path} must be an object")
    return value


def _reject_unknown_keys(payload: dict[str, Any], allowed: frozenset[str], path: str) -> None:
    unknown = sorted(set(payload) - allowed)
    if unknown:
        _fail(f"{path} has unknown key(s): {', '.join(unknown)}")


def _required_string(payload: dict[str, Any], key: str, path: str) -> str:
    if key not in payload:
        _fail(f"{path}{key} is required")
    value = payload[key]
    if not isinstance(value, str) or not value:
        _fail(f"{path}{key} must be a non-empty string")
    return value


def _nullable_string(payload: dict[str, Any], key: str, path: str) -> Any:
    value = payload[key]
    if value is not None and (not isinstance(value, str) or not value):
        _fail(f"{path}{key} must be a non-empty string or null")
    return value


def _bool(payload: dict[str, Any], key: str, path: str) -> bool:
    value = payload[key]
    if not isinstance(value, bool):
        _fail(f"{path}{key} must be a boolean")
    return value


def _int(payload: dict[str, Any], key: str, path: str, *, minimum: int) -> int:
    value = payload[key]
    if isinstance(value, bool) or not isinstance(value, int):
        _fail(f"{path}{key} must be an integer")
    if value < minimum:
        _fail(f"{path}{key} must be >= {minimum}")
    return value


def _string_tuple(payload: dict[str, Any], key: str, path: str) -> tuple[str, ...]:
    value = payload[key]
    if not isinstance(value, list):
        _fail(f"{path}{key} must be an array of strings")
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item:
            _fail(f"{path}{key}[{index}] must be a non-empty string")
    return tuple(value)


def _parse_messages(value: Any) -> tuple[Message, ...]:
    if not isinstance(value, list):
        _fail("messages must be an array")
    if not value:
        _fail("messages must contain at least one message")
    messages: list[Message] = []
    for index, item in enumerate(value):
        path = f"messages[{index}]"
        payload = _check_object(item, path)
        _reject_unknown_keys(payload, _MESSAGE_KEYS, path)
        if "role" not in payload:
            _fail(f"{path}.role is required")
        role = payload["role"]
        if role not in _MESSAGE_ROLES:
            _fail(f"{path}.role must be one of {_MESSAGE_ROLES}, got {role!r}")
        if "content" not in payload:
            _fail(f"{path}.content is required")
        content = payload["content"]
        if not isinstance(content, str):
            _fail(f"{path}.content must be a string")
        is_internal = False
        if "is_internal" in payload:
            is_internal = _bool(payload, "is_internal", f"{path}.")
        messages.append(Message(role=role, content=content, is_internal=is_internal))
    return tuple(messages)


def _parse_customer(value: Any) -> CustomerContext:
    payload = _check_object(value, "customer")
    _reject_unknown_keys(payload, _CUSTOMER_KEYS, "customer")
    defaults = CustomerContext()
    tier = defaults.tier
    if "tier" in payload:
        tier = payload["tier"]
        if tier not in _CUSTOMER_TIERS:
            _fail(f"customer.tier must be one of {_CUSTOMER_TIERS}, got {tier!r}")
    return CustomerContext(
        customer_id=(
            _nullable_string(payload, "customer_id", "customer.")
            if "customer_id" in payload
            else defaults.customer_id
        ),
        email=(
            _nullable_string(payload, "email", "customer.")
            if "email" in payload
            else defaults.email
        ),
        display_name=(
            _nullable_string(payload, "display_name", "customer.")
            if "display_name" in payload
            else defaults.display_name
        ),
        tier=tier,
        locale=(
            _nullable_string(payload, "locale", "customer.")
            if "locale" in payload
            else defaults.locale
        ),
    )


def _parse_tenant(value: Any) -> TenantContext:
    payload = _check_object(value, "tenant")
    _reject_unknown_keys(payload, _TENANT_KEYS, "tenant")
    defaults = TenantContext()
    return TenantContext(
        brand_name=(
            _required_string(payload, "brand_name", "tenant.")
            if "brand_name" in payload
            else defaults.brand_name
        ),
        tone=(
            _required_string(payload, "tone", "tenant.") if "tone" in payload else defaults.tone
        ),
        timezone=(
            _required_string(payload, "timezone", "tenant.")
            if "timezone" in payload
            else defaults.timezone
        ),
    )


def _parse_policy(value: Any) -> PolicyContext:
    payload = _check_object(value, "policy")
    _reject_unknown_keys(payload, _POLICY_KEYS, "policy")
    defaults = PolicyContext()
    return PolicyContext(
        auto_send_allowed_topics=(
            _string_tuple(payload, "auto_send_allowed_topics", "policy.")
            if "auto_send_allowed_topics" in payload
            else defaults.auto_send_allowed_topics
        ),
        active_policy_version_ids=(
            _string_tuple(payload, "active_policy_version_ids", "policy.")
            if "active_policy_version_ids" in payload
            else defaults.active_policy_version_ids
        ),
    )


def _parse_options(value: Any) -> RuntimeOptions:
    payload = _check_object(value, "options")
    _reject_unknown_keys(payload, _OPTIONS_KEYS, "options")
    defaults = RuntimeOptions()
    return RuntimeOptions(
        allow_auto_send=(
            _bool(payload, "allow_auto_send", "options.")
            if "allow_auto_send" in payload
            else defaults.allow_auto_send
        ),
        max_tool_calls=(
            _int(payload, "max_tool_calls", "options.", minimum=0)
            if "max_tool_calls" in payload
            else defaults.max_tool_calls
        ),
        max_retrieved_chunks=(
            _int(payload, "max_retrieved_chunks", "options.", minimum=1)
            if "max_retrieved_chunks" in payload
            else defaults.max_retrieved_chunks
        ),
    )


def parse_runtime_request(payload: Any) -> RuntimeRequest:
    """Parse the wire payload into a :class:`RuntimeRequest` (strict)."""

    body = _check_object(payload, "request body")
    _reject_unknown_keys(body, _TOP_LEVEL_KEYS, "request body")

    ai_run_type = RuntimeRequest.__dataclass_fields__["ai_run_type"].default
    if "ai_run_type" in body:
        ai_run_type = body["ai_run_type"]
        if ai_run_type not in _AI_RUN_TYPES:
            _fail(f"ai_run_type must be one of {_AI_RUN_TYPES}, got {ai_run_type!r}")

    if "messages" not in body:
        _fail("messages is required")

    return RuntimeRequest(
        tenant_id=_required_string(body, "tenant_id", ""),
        ticket_id=_required_string(body, "ticket_id", ""),
        conversation_id=_required_string(body, "conversation_id", ""),
        correlation_id=_required_string(body, "correlation_id", ""),
        messages=_parse_messages(body["messages"]),
        customer=_parse_customer(body["customer"]) if "customer" in body else CustomerContext(),
        tenant=_parse_tenant(body["tenant"]) if "tenant" in body else TenantContext(),
        policy=_parse_policy(body["policy"]) if "policy" in body else PolicyContext(),
        options=_parse_options(body["options"]) if "options" in body else RuntimeOptions(),
        ai_run_type=ai_run_type,
    )
