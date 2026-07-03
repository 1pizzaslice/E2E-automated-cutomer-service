import unittest

from runtime.schemas import (
    Classification,
    FinalRecommendation,
    Message,
    RuntimeRequest,
    RuntimeValidationError,
    ToolCallError,
    ToolCallResult,
    highest_risk,
    most_restrictive_mode,
)


def _request(**overrides) -> RuntimeRequest:
    defaults = dict(
        tenant_id="ten_1",
        ticket_id="tkt_1",
        conversation_id="cnv_1",
        correlation_id="corr_1",
        messages=(Message("customer", "where is my order"),),
    )
    defaults.update(overrides)
    return RuntimeRequest(**defaults)


class RuntimeRequestValidationTest(unittest.TestCase):
    def test_valid_request_passes(self) -> None:
        _request().validate()  # no raise

    def test_rejects_missing_tenant(self) -> None:
        with self.assertRaises(RuntimeValidationError):
            _request(tenant_id="").validate()

    def test_rejects_empty_messages(self) -> None:
        with self.assertRaises(RuntimeValidationError):
            _request(messages=()).validate()

    def test_requires_a_customer_message(self) -> None:
        with self.assertRaises(RuntimeValidationError):
            _request(messages=(Message("agent", "hello"),)).validate()

    def test_latest_customer_message_ignores_internal(self) -> None:
        request = _request(
            messages=(
                Message("customer", "first"),
                Message("customer", "internal note", is_internal=True),
                Message("customer", "latest ask"),
            )
        )
        latest = request.latest_customer_message()
        assert latest is not None
        self.assertEqual(latest.content, "latest ask")


class ClassificationValidationTest(unittest.TestCase):
    def _classification(self, **overrides) -> Classification:
        defaults = dict(
            topic="refund",
            subtopic="eligibility",
            language="en",
            sentiment="neutral",
            urgency="normal",
            priority="p2",
            sensitive_flags=(),
            confidence=0.9,
            reasoning_summary="",
        )
        defaults.update(overrides)
        return Classification(**defaults)

    def test_rejects_unknown_topic(self) -> None:
        with self.assertRaises(RuntimeValidationError):
            self._classification(topic="not_a_topic").validate()

    def test_rejects_confidence_out_of_range(self) -> None:
        with self.assertRaises(RuntimeValidationError):
            self._classification(confidence=1.5).validate()

    def test_hard_sensitive_flag_detection(self) -> None:
        self.assertTrue(self._classification(sensitive_flags=("chargeback",)).has_hard_sensitive_flag())
        self.assertFalse(self._classification(sensitive_flags=("vip_customer",)).has_hard_sensitive_flag())


class ToolCallResultValidationTest(unittest.TestCase):
    def test_succeeded_requires_output(self) -> None:
        result = ToolCallResult(
            status="succeeded", tool_call_id="tc_1", tool_name="order_lookup",
            side_effect_class="read_only", output=None,
        )
        with self.assertRaises(RuntimeValidationError):
            result.validate()

    def test_failed_requires_error(self) -> None:
        result = ToolCallResult(
            status="failed", tool_call_id="tc_1", tool_name="order_lookup",
            side_effect_class="read_only", error=None,
        )
        with self.assertRaises(RuntimeValidationError):
            result.validate()

    def test_blocked_with_error_is_valid(self) -> None:
        ToolCallResult(
            status="blocked", tool_call_id="", tool_name="order_lookup",
            side_effect_class="read_only",
            error=ToolCallError(code="not_visible", message="x"),
        ).validate()


class SeverityHelpersTest(unittest.TestCase):
    def test_most_restrictive_mode(self) -> None:
        self.assertEqual(most_restrictive_mode("auto_send", "human_approve"), "human_approve")
        self.assertEqual(most_restrictive_mode("human_approve", "human_only"), "human_only")
        self.assertEqual(most_restrictive_mode("auto_send", "auto_send"), "auto_send")

    def test_highest_risk(self) -> None:
        self.assertEqual(highest_risk("low", "medium"), "medium")
        self.assertEqual(highest_risk("medium", "high"), "high")

    def test_final_recommendation_bounds(self) -> None:
        with self.assertRaises(RuntimeValidationError):
            FinalRecommendation("human_approve", "low", 2.0, ()).validate()


if __name__ == "__main__":
    unittest.main()
