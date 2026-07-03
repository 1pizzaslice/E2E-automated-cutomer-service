"""Shared tenant/KB/commerce fixtures for the golden eval dataset.

Everything here is deterministic and tenant-scoped. A second tenant
(``TENANT_OTHER``) with its own documents exists only to prove tenant isolation:
a run for ``TENANT_EVAL`` must never surface ``TENANT_OTHER`` evidence.
"""

from __future__ import annotations

from runtime.retrieval import InMemoryRetrieval, KbDocumentFixture
from runtime.tools import CommerceDataset, InMemoryToolExecutor

TENANT_EVAL = "ten_eval"
TENANT_OTHER = "ten_other"


def build_documents() -> list[KbDocumentFixture]:
    return [
        KbDocumentFixture(
            "kb_refund_policy", TENANT_EVAL, "Refund Policy", "policy",
            "Refunds are available within 30 days of purchase for items that are not final sale. "
            "Final sale items cannot be refunded.",
            policy_version_id="polv_refund_1",
        ),
        KbDocumentFixture(
            "kb_cancel_policy", TENANT_EVAL, "Cancellation Policy", "policy",
            "Orders can be canceled before they are shipped. Once an order is shipped or delivered "
            "it cannot be canceled and must be returned.",
            policy_version_id="polv_cancel_1",
        ),
        KbDocumentFixture(
            "kb_shipping_faq", TENANT_EVAL, "Shipping FAQ", "faq",
            "Standard shipping takes 3-5 business days. You can track your order any time using the "
            "tracking link in your confirmation email.",
        ),
        KbDocumentFixture(
            "kb_returns_faq", TENANT_EVAL, "Returns FAQ", "faq",
            "To start a return, use the returns portal within 30 days. Return shipping is free for "
            "defective items.",
        ),
        KbDocumentFixture(
            "kb_hours_faq", TENANT_EVAL, "Store Hours", "faq",
            "Our support team is available Monday to Friday, 9am to 6pm. Warranty covers manufacturing "
            "defects for one year.",
        ),
        # Stale document: excluded from retrieval even though it matches lexically.
        KbDocumentFixture(
            "kb_refund_policy_old", TENANT_EVAL, "Old Refund Policy", "policy",
            "Refunds were previously available within 90 days of purchase for any reason.",
            status="stale", policy_version_id="polv_refund_0",
        ),
        # Different tenant: must never leak into TENANT_EVAL runs.
        KbDocumentFixture(
            "kb_other_refund", TENANT_OTHER, "Other Brand Refund Policy", "policy",
            "Refunds for this other brand are available within 14 days of purchase only.",
            policy_version_id="polv_other_1",
        ),
    ]


def build_commerce() -> dict[str, CommerceDataset]:
    return {
        TENANT_EVAL: CommerceDataset(
            orders={
                "A1001": {"order_number": "A1001", "status": "delivered", "fulfillment_status": "delivered", "placed_days_ago": 5, "final_sale": False},
                "A1002": {"order_number": "A1002", "status": "processing", "fulfillment_status": "processing", "placed_days_ago": 2, "final_sale": False},
                "A1003": {"order_number": "A1003", "status": "delivered", "fulfillment_status": "delivered", "placed_days_ago": 90, "final_sale": True},
                "A1004": {"order_number": "A1004", "status": "shipped", "fulfillment_status": "shipped", "placed_days_ago": 10, "final_sale": False},
            },
            shipments={
                "A1001": {"order_number": "A1001", "tracking_number": "TRK1001", "carrier": "UPS", "status": "delivered"},
                "A1004": {"order_number": "A1004", "tracking_number": "TRK1004", "carrier": "FedEx", "status": "in transit"},
            },
            customers={
                "cus_vip": {"customer_id": "cus_vip", "tier": "vip", "lifetime_orders": 42},
                "cus_std": {"customer_id": "cus_std", "tier": "standard", "lifetime_orders": 3},
            },
        ),
    }


def build_environment() -> tuple[InMemoryRetrieval, InMemoryToolExecutor]:
    retrieval = InMemoryRetrieval(build_documents())
    tool_executor = InMemoryToolExecutor(build_commerce(), retrieval)
    return retrieval, tool_executor
