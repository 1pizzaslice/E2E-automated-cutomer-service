"""Per-run dependencies injected into the graph nodes.

Bundling the ports (model, retrieval, tool executor) plus the trace lets each
node stay a plain ``(state, deps) -> None`` function while the wiring
(:mod:`runtime.support_graph`) binds a concrete set of adapters — deterministic
for offline runs/evals, real SDK-backed for production.
"""

from __future__ import annotations

from dataclasses import dataclass

from .providers import ModelProvider
from .retrieval import RetrievalPort
from .tools import ToolExecutor
from .tracing import RunTrace


@dataclass(frozen=True)
class GraphDependencies:
    model: ModelProvider
    retrieval: RetrievalPort
    tool_executor: ToolExecutor
    trace: RunTrace
