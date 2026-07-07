"""Deterministic trace capture for one AI run (harness section 15).

Traces are reproducible: identifiers derive from the run inputs (no wall-clock or
randomness), so the same request always yields the same ``ai_run_id`` /
``trace_id`` and the same node span sequence. This keeps evals reproducible and
lets a run be replayed and diffed.

The export is redacted: it records structural metadata (node order, prompt/model
versions, tool-call and evidence IDs, guardrail outcome, final recommendation)
but never raw secrets or full provider payloads.
"""

from __future__ import annotations

import hashlib
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

GRAPH_VERSION = "support_graph.v1"


def deterministic_id(prefix: str, *parts: str) -> str:
    """Return a stable, opaque id derived from ``parts``."""

    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:20]}"


@dataclass
class SpanRecord:
    name: str
    order: int
    events: list[str] = field(default_factory=list)


@dataclass
class RunTrace:
    ai_run_id: str
    trace_id: str
    tenant_id: str
    ticket_id: str
    graph_version: str = GRAPH_VERSION
    spans: list[SpanRecord] = field(default_factory=list)
    prompt_versions: dict[str, str] = field(default_factory=dict)
    model_ids: list[str] = field(default_factory=list)
    tool_call_ids: list[str] = field(default_factory=list)
    evidence_ids: list[str] = field(default_factory=list)
    final_recommendation: Optional[dict[str, Any]] = None
    guardrail_result: Optional[dict[str, Any]] = None
    # Aggregated model-call usage (Milestone 15): provider/model of the calls
    # made this run plus token, latency, and cost totals. Deterministic for the
    # offline model, real usage for LLM providers; surfaced on RuntimeResult
    # and persisted to `ai_runs` end to end.
    model_provider: Optional[str] = None
    model_calls: int = 0
    model_input_tokens: int = 0
    model_output_tokens: int = 0
    model_latency_ms: int = 0
    model_cost_estimate: float = 0.0
    _order: int = 0

    @contextmanager
    def span(self, name: str) -> Iterator[SpanRecord]:
        self._order += 1
        record = SpanRecord(name=name, order=self._order)
        self.spans.append(record)
        yield record

    def record_prompt(self, prompt_id: str, version: str) -> None:
        self.prompt_versions[prompt_id] = version

    def record_model(self, model_id: str) -> None:
        if model_id not in self.model_ids:
            self.model_ids.append(model_id)

    def record_usage(self, metadata: Any) -> None:
        """Accumulate one model call's usage (a ``ModelMetadata``-shaped value;
        duck-typed so tracing does not import the provider module)."""

        self.model_provider = str(getattr(metadata, "provider", "") or self.model_provider)
        self.model_calls += 1
        self.model_input_tokens += int(getattr(metadata, "prompt_tokens", 0) or 0)
        self.model_output_tokens += int(getattr(metadata, "completion_tokens", 0) or 0)
        self.model_latency_ms += int(getattr(metadata, "latency_ms", 0) or 0)
        self.model_cost_estimate = round(
            self.model_cost_estimate + float(getattr(metadata, "cost_estimate", 0.0) or 0.0),
            6,
        )

    def model_usage(self) -> Optional[dict[str, Any]]:
        """The run's aggregated model usage, or ``None`` before any model call."""

        if self.model_calls == 0:
            return None
        return {
            "provider": self.model_provider,
            "model_id": self.model_ids[0] if len(self.model_ids) == 1 else ",".join(self.model_ids),
            "prompt_versions": dict(self.prompt_versions),
            "calls": self.model_calls,
            "input_tokens": self.model_input_tokens,
            "output_tokens": self.model_output_tokens,
            "latency_ms": self.model_latency_ms,
            "cost_estimate": self.model_cost_estimate,
        }

    def record_tool_call(self, tool_call_id: str) -> None:
        if tool_call_id and tool_call_id not in self.tool_call_ids:
            self.tool_call_ids.append(tool_call_id)

    def record_evidence(self, evidence_id: str) -> None:
        if evidence_id not in self.evidence_ids:
            self.evidence_ids.append(evidence_id)

    def export(self) -> dict[str, Any]:
        """Redacted, structural trace export (harness section 15)."""

        return {
            "ai_run_id": self.ai_run_id,
            "trace_id": self.trace_id,
            "tenant_id": self.tenant_id,
            "ticket_id": self.ticket_id,
            "graph_version": self.graph_version,
            "node_sequence": [span.name for span in self.spans],
            "prompt_versions": dict(self.prompt_versions),
            "model_ids": list(self.model_ids),
            "tool_call_ids": list(self.tool_call_ids),
            "evidence_ids": list(self.evidence_ids),
            "guardrail_result": self.guardrail_result,
            "final_recommendation": self.final_recommendation,
        }
