"""AI runtime package for support automation.

Public surface:

* :func:`run_support_graph` — run the v1 LangGraph-style support agent graph for
  one AI run and return ``(RuntimeResult, RunTrace)``.
* The structured request/response contracts (``RuntimeRequest``,
  ``RuntimeResult``, ...) in :mod:`runtime.schemas`.
* The pluggable ports: :class:`ModelProvider`, :class:`RetrievalPort`,
  :class:`ToolExecutor`, and their deterministic offline implementations.

``build_initial_decision`` is retained from the Milestone 0-8 scaffold for
backward compatibility.
"""

from .harness import RuntimeDecision, build_initial_decision
from .providers import (
    DeterministicSupportModel,
    ModelProvider,
    ModelRequest,
    ModelResponse,
)
from .retrieval import InMemoryRetrieval, KbDocumentFixture, RetrievalPort
from .runner import run_support_graph
from .schemas import (
    CustomerContext,
    Message,
    PolicyContext,
    RuntimeOptions,
    RuntimeRequest,
    RuntimeResult,
    RuntimeValidationError,
    TenantContext,
)
from .tools import (
    CommerceDataset,
    InMemoryToolExecutor,
    ToolExecutionContext,
    ToolExecutor,
)
from .tracing import RunTrace

__all__ = [
    "RuntimeDecision",
    "build_initial_decision",
    "run_support_graph",
    "RuntimeRequest",
    "RuntimeResult",
    "RuntimeValidationError",
    "Message",
    "CustomerContext",
    "TenantContext",
    "PolicyContext",
    "RuntimeOptions",
    "ModelProvider",
    "ModelRequest",
    "ModelResponse",
    "DeterministicSupportModel",
    "RetrievalPort",
    "InMemoryRetrieval",
    "KbDocumentFixture",
    "ToolExecutor",
    "InMemoryToolExecutor",
    "ToolExecutionContext",
    "CommerceDataset",
    "RunTrace",
]
