import json
import logging
import unittest

from service.config import ServiceConfig
from service.logs import LOGGER_NAME

try:  # the service extra (fastapi + httpx) may not be installed
    from fastapi.testclient import TestClient

    from service.app import create_app

    _HAS_FASTAPI = True
except ModuleNotFoundError:
    _HAS_FASTAPI = False

_TOKEN = "test-service-token"

_SUCCEEDED_KEYS = {
    "status",
    "ai_run_id",
    "trace_id",
    "classification",
    "routing_decision",
    "tool_calls",
    "draft",
    "guardrails",
    "final_recommendation",
    "approval_package",
    "eval_signals",
    "model",
}
_FAILED_KEYS = {
    "status",
    "ai_run_id",
    "trace_id",
    "error_code",
    "error_message",
    "retryable",
    "reason_codes",
    "eval_signals",
    "model",
}


def _config() -> ServiceConfig:
    return ServiceConfig(
        token=_TOKEN,
        mode="local",
        api_base_url=None,
        api_token=None,
        http_timeout_s=5.0,
        environment="test",
    )


def _body(**overrides) -> dict:
    body = {
        "tenant_id": "ten_1",
        "ticket_id": "tkt_1",
        "conversation_id": "cnv_1",
        "correlation_id": "corr_1",
        "messages": [{"role": "customer", "content": "Where is my order #A1001?"}],
    }
    body.update(overrides)
    return body


def _auth() -> dict:
    return {"Authorization": f"Bearer {_TOKEN}"}


class _CaptureHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(record.getMessage())


def _silence_stdout_logging(case: unittest.TestCase) -> None:
    """Swap the service logger's stdout handler for a NullHandler for one test
    case (restored on cleanup) so unittest output stays clean; tests attach
    their own capture handlers to assert on the structured records."""

    logger = logging.getLogger(LOGGER_NAME)
    saved = logger.handlers[:]
    for handler in saved:
        logger.removeHandler(handler)
    logger.addHandler(logging.NullHandler())

    def restore() -> None:
        for handler in logger.handlers[:]:
            logger.removeHandler(handler)
        for handler in saved:
            logger.addHandler(handler)

    case.addCleanup(restore)


@unittest.skipUnless(_HAS_FASTAPI, "fastapi/httpx not installed (uv sync --extra service)")
class AppTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(create_app(_config()))
        _silence_stdout_logging(self)

    def test_health_requires_no_auth(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "ok",
                "service": "ai-runtime",
                "mode": "local",
                "graph_version": "support_graph.v1",
                "model_provider": "deterministic",
            },
        )

    def test_missing_bearer_is_401(self) -> None:
        response = self.client.post("/internal/ai/run", json=_body())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "AUTH_REQUIRED")

    def test_wrong_bearer_is_401(self) -> None:
        response = self.client.post(
            "/internal/ai/run", json=_body(), headers={"Authorization": "Bearer wrong"}
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "AUTH_REQUIRED")

    def test_malformed_json_body_is_400(self) -> None:
        response = self.client.post(
            "/internal/ai/run",
            content=b"{not json",
            headers={**_auth(), "content-type": "application/json"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "VALIDATION_ERROR")

    def test_unknown_key_body_is_400(self) -> None:
        response = self.client.post(
            "/internal/ai/run", json=_body(bogus=1), headers=_auth()
        )
        self.assertEqual(response.status_code, 400)
        error = response.json()["error"]
        self.assertEqual(error["code"], "VALIDATION_ERROR")
        self.assertIn("bogus", error["message"])

    def test_minimal_local_mode_run_succeeds_with_exact_result_keys(self) -> None:
        response = self.client.post("/internal/ai/run", json=_body(), headers=_auth())
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(set(payload), _SUCCEEDED_KEYS)
        self.assertEqual(payload["status"], "succeeded")
        self.assertTrue(payload["ai_run_id"].startswith("air_"))
        self.assertEqual(payload["routing_decision"]["topic"], "order_status")

    def test_run_without_customer_visible_message_is_200_failed(self) -> None:
        body = _body(messages=[{"role": "agent", "content": "internal note only"}])
        response = self.client.post("/internal/ai/run", json=body, headers=_auth())
        self.assertEqual(response.status_code, 200)  # a failed run is a domain outcome
        payload = response.json()
        self.assertEqual(set(payload), _FAILED_KEYS)
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["error_code"], "INPUT_VALIDATION_FAILED")
        self.assertIn("route_to_human", payload["reason_codes"])

    def test_run_emits_one_structured_log_line_with_correlation_id(self) -> None:
        handler = _CaptureHandler()
        logger = logging.getLogger(LOGGER_NAME)
        logger.addHandler(handler)
        self.addCleanup(logger.removeHandler, handler)

        response = self.client.post("/internal/ai/run", json=_body(), headers=_auth())
        self.assertEqual(response.status_code, 200)

        events = [json.loads(line) for line in handler.lines]
        run_events = [e for e in events if e["message"] == "ai run completed"]
        self.assertEqual(len(run_events), 1)
        event = run_events[0]
        self.assertEqual(event["service"], "ai-runtime")
        self.assertEqual(event["environment"], "test")
        self.assertEqual(event["level"], "info")
        self.assertEqual(event["correlation_id"], "corr_1")
        self.assertEqual(event["tenant_id"], "ten_1")
        self.assertEqual(event["ticket_id"], "tkt_1")
        self.assertEqual(event["status"], "succeeded")
        self.assertIn("duration_ms", event)
        self.assertIn("trace_id", event)
        self.assertIn("ai_run_id", event)

    def test_rejected_body_log_honors_correlation_header(self) -> None:
        handler = _CaptureHandler()
        logger = logging.getLogger(LOGGER_NAME)
        logger.addHandler(handler)
        self.addCleanup(logger.removeHandler, handler)

        response = self.client.post(
            "/internal/ai/run",
            content=b"{not json",
            headers={**_auth(), "content-type": "application/json", "x-correlation-id": "corr_hdr"},
        )
        self.assertEqual(response.status_code, 400)
        events = [json.loads(line) for line in handler.lines]
        rejected = [e for e in events if e["message"] == "ai run rejected"]
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0]["correlation_id"], "corr_hdr")
        self.assertEqual(rejected[0]["error_code"], "VALIDATION_ERROR")


@unittest.skipUnless(_HAS_FASTAPI, "fastapi/httpx not installed (uv sync --extra service)")
class PortsFactoryTest(unittest.TestCase):
    def test_ports_factory_receives_parsed_request_and_supplies_ports(self) -> None:
        _silence_stdout_logging(self)
        from runtime.providers import DeterministicSupportModel
        from runtime.retrieval import InMemoryRetrieval, KbDocumentFixture
        from runtime.tools import InMemoryToolExecutor

        seen: list = []

        def ports_factory(runtime_request):
            seen.append(runtime_request)
            retrieval = InMemoryRetrieval(
                [
                    KbDocumentFixture(
                        "kb_ship", "ten_1", "Shipping FAQ", "faq",
                        "Standard shipping takes 3-5 business days.",
                    )
                ]
            )
            return (
                DeterministicSupportModel(),
                retrieval,
                InMemoryToolExecutor({}, retrieval),
            )

        client = TestClient(create_app(_config(), ports_factory=ports_factory))
        body = _body(messages=[{"role": "customer", "content": "How long does shipping take?"}])
        response = client.post("/internal/ai/run", json=body, headers=_auth())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0].tenant_id, "ten_1")
        payload = response.json()
        self.assertEqual(payload["status"], "succeeded")
        # Evidence from the injected retrieval port made it into the run.
        self.assertIn("kb_ship", payload["routing_decision"]["required_evidence"])


if __name__ == "__main__":
    unittest.main()
