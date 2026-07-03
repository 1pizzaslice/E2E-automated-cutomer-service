"""Tool-execution port (harness sections 6.7 / 11, Milestone 8 envelope).

The graph *plans* tool calls; a backend registry *executes* them. In production
the tool-execution node calls the TypeScript tool registry
(``packages/api/src/tool-registry.ts``) over the ``ToolCallRequest`` /
``ToolCallResult`` envelope. For offline runs and evals,
:class:`InMemoryToolExecutor` reproduces that registry's governance semantics in
Python over deterministic commerce fixtures:

* permission-class check against the caller's granted permissions,
* argument-schema validation (missing/blank required args → ``invalid_arguments``),
* bounded, AI-safe results (oversized output → ``result_too_large``),
* a stable ``tool_call_id`` per call (the audit anchor),
* unknown/invisible tools → ``blocked`` / ``not_visible`` with no output.

All six V1 tools are ``read_only`` (harness section 6.6): none mutate external
state, matching ADR-0010 (no high-risk side effects in v1).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol

from .retrieval import RetrievalPort
from .schemas import (
    RetrievalQuery,
    ToolCallError,
    ToolCallRequest,
    ToolCallResult,
)
from .tracing import deterministic_id

_MAX_RESULT_BYTES = 16 * 1024

# tool_name -> (permission_class, required-arg groups). Each group is a set of
# argument names; the call is valid if any one group is fully present.
_TOOL_PERMISSION = {
    "order_lookup": "order_read",
    "shipment_tracking_lookup": "order_read",
    "refund_eligibility": "eligibility_evaluate",
    "cancellation_eligibility": "eligibility_evaluate",
    "customer_profile_lookup": "customer_read",
    "kb_search": "kb_read",
}


def permission_for_tool(tool_name: str) -> str:
    """Return the permission class a caller must hold to run ``tool_name``.

    Used by the policy/tool-execution nodes to derive the AI runtime's granted
    permission set from the policy's allowed tools (the Milestone 8 follow-up:
    wire ``grantedPermissions`` to the AI runtime policy instead of a
    caller-supplied set).
    """

    return _TOOL_PERMISSION[tool_name]


@dataclass(frozen=True)
class CommerceDataset:
    """Tenant-scoped mock commerce data behind the tool executor."""

    orders: dict[str, dict[str, Any]] = field(default_factory=dict)
    shipments: dict[str, dict[str, Any]] = field(default_factory=dict)
    customers: dict[str, dict[str, Any]] = field(default_factory=dict)
    refund_window_days: int = 30


@dataclass(frozen=True)
class ToolExecutionContext:
    tenant_id: str
    ticket_id: str
    ai_run_id: str
    granted_permissions: frozenset[str]


class ToolExecutor(Protocol):
    def execute(
        self, request: ToolCallRequest, context: ToolExecutionContext
    ) -> ToolCallResult: ...


class InMemoryToolExecutor:
    def __init__(
        self,
        datasets: dict[str, CommerceDataset],
        retrieval: Optional[RetrievalPort] = None,
    ) -> None:
        self._datasets = datasets
        self._retrieval = retrieval
        self._handlers: dict[str, Callable[[dict[str, Any], CommerceDataset, ToolExecutionContext], Optional[dict[str, Any]]]] = {
            "order_lookup": self._order_lookup,
            "shipment_tracking_lookup": self._shipment_lookup,
            "refund_eligibility": self._refund_eligibility,
            "cancellation_eligibility": self._cancellation_eligibility,
            "customer_profile_lookup": self._customer_lookup,
            "kb_search": self._kb_search,
        }

    def execute(self, request: ToolCallRequest, context: ToolExecutionContext) -> ToolCallResult:
        tool_name = request.tool_name
        if tool_name not in self._handlers:
            return self._blocked(tool_name, "not_visible", f"tool {tool_name!r} is not available")

        tool_call_id = deterministic_id(
            "tc", context.tenant_id, context.ai_run_id, tool_name, json.dumps(request.arguments, sort_keys=True)
        )
        permission = _TOOL_PERMISSION[tool_name]
        if permission not in context.granted_permissions:
            return self._failed(tool_call_id, tool_name, "unauthorized", f"missing permission {permission}")

        args_error = self._validate_args(tool_name, request.arguments)
        if args_error is not None:
            return self._failed(tool_call_id, tool_name, "invalid_arguments", args_error)

        dataset = self._datasets.get(context.tenant_id, CommerceDataset())
        try:
            output = self._handlers[tool_name](request.arguments, dataset, context)
        except Exception as exc:  # defensive: a handler bug must not crash the graph
            return self._failed(tool_call_id, tool_name, "tool_error", str(exc))

        if output is None:
            return self._failed(tool_call_id, tool_name, "not_found", "no matching record")

        serialized = json.dumps(output)
        if len(serialized.encode("utf-8")) > _MAX_RESULT_BYTES:
            return self._failed(tool_call_id, tool_name, "result_too_large", "tool output exceeded size bound")

        return ToolCallResult(
            status="succeeded",
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            side_effect_class="read_only",
            output=output,
        )

    # -- validation -----------------------------------------------------------

    def _validate_args(self, tool_name: str, args: dict[str, Any]) -> Optional[str]:
        def has(name: str) -> bool:
            value = args.get(name)
            return isinstance(value, str) and bool(value.strip())

        if tool_name in ("order_lookup", "refund_eligibility", "cancellation_eligibility"):
            if not has("order_number"):
                return "order_number is required"
        elif tool_name == "shipment_tracking_lookup":
            if not has("order_number") and not has("tracking_number"):
                return "order_number or tracking_number is required"
        elif tool_name == "customer_profile_lookup":
            if not has("customer_id") and not has("email"):
                return "customer_id or email is required"
        elif tool_name == "kb_search":
            if not has("query"):
                return "query is required"
        return None

    # -- handlers -------------------------------------------------------------

    def _order_lookup(self, args, dataset, context):
        return dataset.orders.get(str(args["order_number"]))

    def _shipment_lookup(self, args, dataset, context):
        key = str(args.get("tracking_number") or args.get("order_number"))
        if key in dataset.shipments:
            return dataset.shipments[key]
        # Fall back to matching a shipment by its order_number field.
        for shipment in dataset.shipments.values():
            if shipment.get("order_number") == args.get("order_number"):
                return shipment
        return None

    def _refund_eligibility(self, args, dataset, context):
        order = dataset.orders.get(str(args["order_number"]))
        if order is None:
            return None
        final_sale = bool(order.get("final_sale", False))
        placed_days_ago = int(order.get("placed_days_ago", 0))
        within_window = placed_days_ago <= dataset.refund_window_days
        eligible = (not final_sale) and within_window
        if final_sale:
            reason = "the item was a final-sale purchase"
        elif not within_window:
            reason = f"the order is outside the {dataset.refund_window_days}-day refund window"
        else:
            reason = "the order is within the refund window and not final sale"
        return {
            "order_number": order.get("order_number"),
            "eligible": eligible,
            "reason": reason,
            "refund_window_days": dataset.refund_window_days,
        }

    def _cancellation_eligibility(self, args, dataset, context):
        order = dataset.orders.get(str(args["order_number"]))
        if order is None:
            return None
        fulfillment = str(order.get("fulfillment_status", "unfulfilled"))
        cancellable = fulfillment in ("unfulfilled", "processing")
        return {
            "order_number": order.get("order_number"),
            "cancellable": cancellable,
            "fulfillment_status": fulfillment,
        }

    def _customer_lookup(self, args, dataset, context):
        key = str(args.get("customer_id") or args.get("email"))
        profile = dataset.customers.get(key)
        if profile is None:
            for candidate in dataset.customers.values():
                if candidate.get("email") == args.get("email"):
                    profile = candidate
                    break
        if profile is None:
            return None
        # Minimize before returning to the graph (harness section 11).
        return {
            "customer_id": profile.get("customer_id"),
            "tier": profile.get("tier", "standard"),
            "lifetime_orders": profile.get("lifetime_orders", 0),
        }

    def _kb_search(self, args, dataset, context):
        if self._retrieval is None:
            return {"results": []}
        query = RetrievalQuery(query=str(args["query"]), document_type=args.get("document_type"))
        evidence = self._retrieval.search(context.tenant_id, query, limit=5)
        return {
            "results": [
                {
                    "ref_id": item.ref_id,
                    "document_title": item.document_title,
                    "document_type": item.document_type,
                    "content_excerpt": item.content_excerpt,
                    "relevance_score": item.relevance_score,
                }
                for item in evidence
            ]
        }

    # -- result constructors --------------------------------------------------

    def _blocked(self, tool_name: str, code: str, message: str) -> ToolCallResult:
        return ToolCallResult(
            status="blocked",
            tool_call_id="",
            tool_name=tool_name,
            side_effect_class="read_only",
            error=ToolCallError(code=code, message=message),
        )

    def _failed(self, tool_call_id: str, tool_name: str, code: str, message: str) -> ToolCallResult:
        return ToolCallResult(
            status="failed",
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            side_effect_class="read_only",
            error=ToolCallError(code=code, message=message),
        )
