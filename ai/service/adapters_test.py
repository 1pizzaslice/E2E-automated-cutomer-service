import unittest

from runtime.retrieval import InMemoryRetrieval, KbDocumentFixture
from runtime.schemas import RetrievalQuery, ToolCallRequest
from runtime.tools import ToolExecutionContext
from service.adapters import HttpRetrieval, HttpToolExecutor, RetrievalUnavailableError
from service.http import HttpJsonResponse, HttpTransportError


class _RecordingPost:
    """Fake for the injectable post seam: records calls, returns/raises canned."""

    def __init__(self, outcome) -> None:
        self.outcome = outcome
        self.calls: list[dict] = []

    def __call__(self, url, *, headers, body, timeout_s):
        self.calls.append(
            {"url": url, "headers": dict(headers), "body": body, "timeout_s": timeout_s}
        )
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def _context(**overrides) -> ToolExecutionContext:
    fields = {
        "tenant_id": "ten_1",
        "ticket_id": "tkt_1",
        "ai_run_id": "air_1",
        "granted_permissions": frozenset({"order_read", "customer_read"}),
    }
    fields.update(overrides)
    return ToolExecutionContext(**fields)


def _tool_executor(post, **overrides) -> HttpToolExecutor:
    kwargs = {"correlation_id": "corr_1", "post": post, "timeout_s": 2.5}
    kwargs.update(overrides)
    return HttpToolExecutor("http://api.internal:3000", "int-token", **kwargs)


def _succeeded_envelope(**overrides) -> dict:
    envelope = {
        "status": "succeeded",
        "tool_call_id": "tc_abc",
        "tool_name": "order_lookup",
        "side_effect_class": "read_only",
        "output": {"order_number": "A1001", "status": "delivered"},
        "idempotent_replay": False,
    }
    envelope.update(overrides)
    return envelope


class HttpToolExecutorRequestShapeTest(unittest.TestCase):
    def test_posts_exact_internal_tool_execute_body(self) -> None:
        post = _RecordingPost(HttpJsonResponse(200, _succeeded_envelope()))
        executor = _tool_executor(post)
        request = ToolCallRequest(tool_name="order_lookup", arguments={"order_number": "A1001"})
        executor.execute(request, _context())

        self.assertEqual(len(post.calls), 1)
        call = post.calls[0]
        self.assertEqual(call["url"], "http://api.internal:3000/internal/tools/execute")
        self.assertEqual(call["timeout_s"], 2.5)
        self.assertEqual(
            call["body"],
            {
                "tenant_id": "ten_1",
                "ticket_id": "tkt_1",
                "ai_run_id": "air_1",
                # sorted, deterministic wire order
                "granted_permissions": ["customer_read", "order_read"],
                "request": {
                    "tool_name": "order_lookup",
                    "arguments": {"order_number": "A1001"},
                },
            },
        )
        self.assertEqual(call["headers"]["Authorization"], "Bearer int-token")
        self.assertEqual(call["headers"]["content-type"], "application/json")
        self.assertEqual(call["headers"]["x-correlation-id"], "corr_1")

    def test_idempotency_key_included_only_when_set(self) -> None:
        post = _RecordingPost(HttpJsonResponse(200, _succeeded_envelope()))
        executor = _tool_executor(post)
        executor.execute(
            ToolCallRequest(
                tool_name="order_lookup",
                arguments={"order_number": "A1001"},
                idempotency_key="idem-1",
            ),
            _context(),
        )
        self.assertEqual(post.calls[0]["body"]["request"]["idempotency_key"], "idem-1")


class HttpToolExecutorResponseMappingTest(unittest.TestCase):
    def test_maps_succeeded_envelope(self) -> None:
        envelope = _succeeded_envelope(idempotent_replay=True)
        executor = _tool_executor(_RecordingPost(HttpJsonResponse(200, envelope)))
        result = executor.execute(
            ToolCallRequest(tool_name="order_lookup", arguments={"order_number": "A1001"}),
            _context(),
        )
        self.assertEqual(result.status, "succeeded")
        self.assertEqual(result.tool_call_id, "tc_abc")
        self.assertEqual(result.tool_name, "order_lookup")
        self.assertEqual(result.side_effect_class, "read_only")
        self.assertTrue(result.idempotent_replay)
        self.assertEqual(result.output, {"order_number": "A1001", "status": "delivered"})
        self.assertIsNone(result.error)

    def test_maps_failed_envelope(self) -> None:
        envelope = {
            "status": "failed",
            "tool_call_id": "tc_abc",
            "tool_name": "order_lookup",
            "side_effect_class": "read_only",
            "error": {"code": "not_found", "message": "no matching record"},
            "idempotent_replay": False,
        }
        executor = _tool_executor(_RecordingPost(HttpJsonResponse(200, envelope)))
        result = executor.execute(
            ToolCallRequest(tool_name="order_lookup", arguments={"order_number": "NOPE"}),
            _context(),
        )
        self.assertEqual(result.status, "failed")
        assert result.error is not None
        self.assertEqual(result.error.code, "not_found")

    def test_maps_blocked_envelope(self) -> None:
        envelope = {
            "status": "blocked",
            "tool_call_id": "",
            "tool_name": "mystery_tool",
            "side_effect_class": "read_only",
            "error": {"code": "not_visible", "message": "tool is not available"},
            "idempotent_replay": False,
        }
        executor = _tool_executor(_RecordingPost(HttpJsonResponse(200, envelope)))
        result = executor.execute(
            ToolCallRequest(tool_name="mystery_tool", arguments={}), _context()
        )
        self.assertEqual(result.status, "blocked")
        assert result.error is not None
        self.assertEqual(result.error.code, "not_visible")

    def test_non_200_becomes_failed_tool_error(self) -> None:
        executor = _tool_executor(_RecordingPost(HttpJsonResponse(503, {"error": "down"})))
        result = executor.execute(
            ToolCallRequest(tool_name="order_lookup", arguments={"order_number": "A1001"}),
            _context(),
        )
        self.assertEqual(result.status, "failed")
        assert result.error is not None
        self.assertEqual(result.error.code, "tool_error")
        self.assertIn("503", result.error.message)
        self.assertEqual(result.tool_name, "order_lookup")

    def test_transport_error_becomes_failed_tool_error(self) -> None:
        executor = _tool_executor(_RecordingPost(HttpTransportError("connection refused")))
        result = executor.execute(
            ToolCallRequest(tool_name="order_lookup", arguments={"order_number": "A1001"}),
            _context(),
        )
        self.assertEqual(result.status, "failed")
        assert result.error is not None
        self.assertEqual(result.error.code, "tool_error")

    def test_malformed_200_bodies_become_failed_tool_error(self) -> None:
        malformed = (
            ["not", "an", "object"],
            {"status": "nope"},
            _succeeded_envelope(output="not an object"),
            _succeeded_envelope(status="failed"),  # failed without error
            {
                "status": "failed",
                "tool_call_id": "tc_1",
                "tool_name": "order_lookup",
                "side_effect_class": "read_only",
                "error": {"code": "not_a_code", "message": "x"},
                "idempotent_replay": False,
            },
        )
        for body in malformed:
            executor = _tool_executor(_RecordingPost(HttpJsonResponse(200, body)))
            result = executor.execute(
                ToolCallRequest(tool_name="order_lookup", arguments={"order_number": "A1001"}),
                _context(),
            )
            self.assertEqual(result.status, "failed", msg=repr(body))
            assert result.error is not None
            self.assertEqual(result.error.code, "tool_error", msg=repr(body))

    def test_never_raises_even_on_unexpected_post_exception(self) -> None:
        executor = _tool_executor(_RecordingPost(ValueError("boom")))
        result = executor.execute(
            ToolCallRequest(tool_name="order_lookup", arguments={"order_number": "A1001"}),
            _context(),
        )
        self.assertEqual(result.status, "failed")
        assert result.error is not None
        self.assertEqual(result.error.code, "tool_error")


_PARITY_DOCS = [
    KbDocumentFixture(
        "kb_refund_policy",
        "ten_1",
        "Refund Policy",
        "policy",
        "Refunds are available within 30 days of purchase for items that are not final sale. "
        + "Every extra sentence pads this content well past the excerpt bound. " * 10,
        policy_version_id="polv_refund_1",
    ),
    KbDocumentFixture(
        "kb_shipping_faq",
        "ten_1",
        "Shipping FAQ",
        "faq",
        "Standard shipping takes 3-5 business days. Refunds of shipping fees are rare.",
    ),
]


def _wire_result_from_fixture(doc: KbDocumentFixture, score: float) -> dict:
    """The /v1/kb/search hit equivalent to a fixture doc (KbSearchResultSchema)."""

    metadata = {"source": "ingest-snapshot"}
    if doc.policy_version_id is not None:
        metadata["policy_version_id"] = doc.policy_version_id
    return {
        "kb_chunk_id": doc.document_id,
        "tenant_id": doc.tenant_id,
        "kb_document_id": f"doc_{doc.document_id}",
        "chunk_index": 0,
        "content": doc.content,
        "status": "active",
        "metadata": metadata,
        "created_at": "2026-07-01T00:00:00Z",
        "score": score,
        "document_title": doc.title,
        "document_type": doc.document_type,
        "source_type": "manual",
        "source_ref": None,
    }


def _retrieval(post, **overrides) -> HttpRetrieval:
    kwargs = {"correlation_id": "corr_1", "post": post, "timeout_s": 2.5}
    kwargs.update(overrides)
    return HttpRetrieval("http://api.internal:3000/", "int-token", **kwargs)


class HttpRetrievalParityTest(unittest.TestCase):
    def test_wire_mapping_matches_in_memory_retrieval(self) -> None:
        query = RetrievalQuery(query="refund policy shipping")
        in_memory = InMemoryRetrieval(_PARITY_DOCS)
        expected = in_memory.search("ten_1", query, limit=5)
        self.assertEqual(len(expected), 2)  # both docs match; sanity

        # Build the equivalent /v1/kb/search response in the same rank order,
        # carrying the same scores the lexical scorer produced.
        by_ref = {doc.document_id: doc for doc in _PARITY_DOCS}
        wire = [
            _wire_result_from_fixture(by_ref[e.ref_id], e.relevance_score) for e in expected
        ]
        post = _RecordingPost(HttpJsonResponse(200, {"results": wire, "page": {}}))
        actual = _retrieval(post).search("ten_1", query, limit=5)

        self.assertEqual(actual, expected)  # identical Evidence, field for field
        # The mirror covers: evidence_id derivation, policy-vs-kb_chunk type,
        # 400-char excerpt truncation, and metadata-sourced policy_version_id.
        self.assertEqual(actual[0].type, "policy")
        self.assertEqual(actual[0].policy_version_id, "polv_refund_1")
        self.assertEqual(len(actual[0].content_excerpt), 400)
        self.assertEqual(actual[1].type, "kb_chunk")
        self.assertIsNone(actual[1].policy_version_id)

    def test_request_body_headers_and_document_type_filter(self) -> None:
        post = _RecordingPost(HttpJsonResponse(200, {"results": [], "page": {}}))
        _retrieval(post).search(
            "ten_1", RetrievalQuery(query="refund policy", document_type="policy"), limit=4
        )
        call = post.calls[0]
        self.assertEqual(call["url"], "http://api.internal:3000/v1/kb/search")
        self.assertEqual(
            call["body"], {"query": "refund policy", "limit": 4, "document_type": "policy"}
        )
        self.assertEqual(call["headers"]["Authorization"], "Bearer int-token")
        self.assertEqual(call["headers"]["x-tenant-id"], "ten_1")
        self.assertEqual(call["headers"]["x-correlation-id"], "corr_1")

    def test_document_type_outside_api_enum_is_omitted(self) -> None:
        post = _RecordingPost(HttpJsonResponse(200, {"results": [], "page": {}}))
        _retrieval(post).search(
            "ten_1", RetrievalQuery(query="refund", document_type="internal_note"), limit=4
        )
        self.assertNotIn("document_type", post.calls[0]["body"])

    def test_limit_respected_even_if_server_over_returns(self) -> None:
        wire = [
            _wire_result_from_fixture(_PARITY_DOCS[0], 0.9),
            _wire_result_from_fixture(_PARITY_DOCS[1], 0.8),
            _wire_result_from_fixture(_PARITY_DOCS[1], 0.7),
        ]
        post = _RecordingPost(HttpJsonResponse(200, {"results": wire, "page": {}}))
        evidence = _retrieval(post).search("ten_1", RetrievalQuery(query="refund"), limit=2)
        self.assertEqual(len(evidence), 2)

    def test_empty_query_returns_no_evidence_without_calling_api(self) -> None:
        post = _RecordingPost(HttpJsonResponse(200, {"results": [], "page": {}}))
        evidence = _retrieval(post).search("ten_1", RetrievalQuery(query="   "), limit=2)
        self.assertEqual(evidence, [])
        self.assertEqual(post.calls, [])

    def test_non_200_raises_retrieval_unavailable(self) -> None:
        post = _RecordingPost(HttpJsonResponse(500, {"error": "boom"}))
        with self.assertRaises(RetrievalUnavailableError):
            _retrieval(post).search("ten_1", RetrievalQuery(query="refund"), limit=2)

    def test_transport_error_raises_retrieval_unavailable(self) -> None:
        post = _RecordingPost(HttpTransportError("dns failure"))
        with self.assertRaises(RetrievalUnavailableError):
            _retrieval(post).search("ten_1", RetrievalQuery(query="refund"), limit=2)

    def test_malformed_response_raises_retrieval_unavailable(self) -> None:
        for body in ({"nope": 1}, {"results": "not a list"}, {"results": [{"kb_chunk_id": 7}]}):
            post = _RecordingPost(HttpJsonResponse(200, body))
            with self.assertRaises(RetrievalUnavailableError, msg=repr(body)):
                _retrieval(post).search("ten_1", RetrievalQuery(query="refund"), limit=2)


if __name__ == "__main__":
    unittest.main()
