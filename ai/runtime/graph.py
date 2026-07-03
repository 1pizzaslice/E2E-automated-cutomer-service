"""A tiny, dependency-free graph engine that mirrors LangGraph's node model.

The real orchestration library is deferred (ADR-0016): LangGraph is not
installable in the local harness. This engine reproduces the subset of the
LangGraph API the v1 support graph needs — ``add_node``, ``set_entry_point``,
``add_edge``, ``add_conditional_edges`` and ``compile().invoke(state)`` — so node
code is written exactly as it would be for LangGraph and can be lifted onto the
real library later behind the same node signatures.

Each node is a callable ``(state) -> None`` that mutates the shared
:class:`~runtime.state.AgentState` in place (the equivalent of returning a
partial state update). Every node execution is recorded as a trace span.
"""

from __future__ import annotations

from typing import Callable, Optional

from .state import AgentState
from .tracing import RunTrace

END = "__end__"

NodeFn = Callable[[AgentState], None]
RouterFn = Callable[[AgentState], str]


class GraphConfigError(ValueError):
    """Raised when the graph is wired incorrectly (unknown node, no entry)."""


class _CompiledGraph:
    def __init__(
        self,
        nodes: dict[str, NodeFn],
        entry: str,
        edges: dict[str, str],
        conditional: dict[str, tuple[RouterFn, dict[str, str]]],
        max_steps: int,
    ) -> None:
        self._nodes = nodes
        self._entry = entry
        self._edges = edges
        self._conditional = conditional
        self._max_steps = max_steps

    def invoke(self, state: AgentState, trace: Optional[RunTrace] = None) -> AgentState:
        current = self._entry
        steps = 0
        while current != END:
            steps += 1
            if steps > self._max_steps:
                raise GraphConfigError(
                    f"graph exceeded {self._max_steps} steps; possible cycle at {current!r}"
                )
            node = self._nodes[current]
            if trace is not None:
                with trace.span(current):
                    node(state)
            else:
                node(state)
            current = self._next(current, state)
        return state

    def _next(self, current: str, state: AgentState) -> str:
        if current in self._conditional:
            router, mapping = self._conditional[current]
            key = router(state)
            if key not in mapping:
                raise GraphConfigError(
                    f"conditional router for {current!r} returned unknown key {key!r}"
                )
            return mapping[key]
        return self._edges[current]


class StateGraph:
    """Builder for the support graph. Mirrors LangGraph's ``StateGraph``."""

    def __init__(self, *, max_steps: int = 64) -> None:
        self._nodes: dict[str, NodeFn] = {}
        self._edges: dict[str, str] = {}
        self._conditional: dict[str, tuple[RouterFn, dict[str, str]]] = {}
        self._entry: Optional[str] = None
        self._max_steps = max_steps

    def add_node(self, name: str, fn: NodeFn) -> "StateGraph":
        if name == END:
            raise GraphConfigError(f"{END!r} is a reserved node name")
        if name in self._nodes:
            raise GraphConfigError(f"duplicate node {name!r}")
        self._nodes[name] = fn
        return self

    def set_entry_point(self, name: str) -> "StateGraph":
        self._entry = name
        return self

    def add_edge(self, src: str, dst: str) -> "StateGraph":
        self._edges[src] = dst
        return self

    def add_conditional_edges(
        self, src: str, router: RouterFn, mapping: dict[str, str]
    ) -> "StateGraph":
        self._conditional[src] = (router, dict(mapping))
        return self

    def compile(self) -> _CompiledGraph:
        if self._entry is None:
            raise GraphConfigError("no entry point set")
        if self._entry not in self._nodes:
            raise GraphConfigError(f"entry point {self._entry!r} is not a node")
        for src, dst in self._edges.items():
            if src not in self._nodes:
                raise GraphConfigError(f"edge source {src!r} is not a node")
            if dst != END and dst not in self._nodes:
                raise GraphConfigError(f"edge target {dst!r} is not a node")
        for src, (_, mapping) in self._conditional.items():
            if src not in self._nodes:
                raise GraphConfigError(f"conditional source {src!r} is not a node")
            for dst in mapping.values():
                if dst != END and dst not in self._nodes:
                    raise GraphConfigError(f"conditional target {dst!r} is not a node")
        # Every node needs an outgoing edge unless it is purely conditional.
        for name in self._nodes:
            if name not in self._edges and name not in self._conditional:
                raise GraphConfigError(f"node {name!r} has no outgoing edge")
        return _CompiledGraph(
            self._nodes, self._entry, self._edges, self._conditional, self._max_steps
        )
