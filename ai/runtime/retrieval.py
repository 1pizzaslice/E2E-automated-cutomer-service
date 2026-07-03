"""Retrieval port for the graph (harness section 10, ADR-0015).

In production the retrieval node calls the Milestone 7 ``POST /v1/kb/search``
endpoint (tenant-scoped cosine nearest-neighbour over active chunks). For offline
runs and evals, :class:`InMemoryRetrieval` reproduces that contract with a
deterministic lexical scorer over document fixtures. Both:

* filter by tenant (never cross a tenant boundary),
* exclude stale/inactive documents,
* return citation metadata and relevance scores,
* treat document content as untrusted data — it is returned verbatim as
  evidence and is never interpreted as instructions.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

from .schemas import Evidence, RetrievalQuery
from .tracing import deterministic_id

_WORD_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return set(_WORD_RE.findall(text.lower()))


@dataclass(frozen=True)
class KbDocumentFixture:
    document_id: str
    tenant_id: str
    title: str
    document_type: str  # "policy" | "faq" | "macro" | "sop"
    content: str
    status: str = "active"  # "active" | "stale" | "archived"
    policy_version_id: str | None = None


class RetrievalPort(Protocol):
    def search(
        self, tenant_id: str, query: RetrievalQuery, *, limit: int
    ) -> list[Evidence]: ...


class InMemoryRetrieval:
    """Deterministic lexical retrieval over document fixtures."""

    def __init__(self, documents: list[KbDocumentFixture]) -> None:
        self._documents = list(documents)

    def search(self, tenant_id: str, query: RetrievalQuery, *, limit: int) -> list[Evidence]:
        query_tokens = _tokens(query.query)
        if not query_tokens:
            return []

        scored: list[tuple[float, KbDocumentFixture]] = []
        for doc in self._documents:
            if doc.tenant_id != tenant_id:
                continue  # tenant isolation
            if doc.status != "active":
                continue  # stale/archived exclusion (ADR-0015)
            if query.document_type is not None and doc.document_type != query.document_type:
                continue
            doc_tokens = _tokens(f"{doc.title} {doc.content}")
            overlap = query_tokens & doc_tokens
            if not overlap:
                continue
            # Deterministic lexical relevance: overlap normalized by query size.
            score = len(overlap) / len(query_tokens)
            scored.append((score, doc))

        # Sort by score desc, then by document_id for a stable tie-break.
        scored.sort(key=lambda pair: (-pair[0], pair[1].document_id))

        evidence: list[Evidence] = []
        for score, doc in scored[:limit]:
            evidence.append(
                Evidence(
                    evidence_id=deterministic_id("ev", tenant_id, doc.document_id, query.query),
                    type="policy" if doc.document_type == "policy" else "kb_chunk",
                    ref_id=doc.document_id,
                    document_title=doc.title,
                    document_type=doc.document_type,
                    content_excerpt=doc.content[:400],
                    relevance_score=round(score, 4),
                    policy_version_id=doc.policy_version_id,
                )
            )
        return evidence
