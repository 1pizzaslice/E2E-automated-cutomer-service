import unittest

from runtime.schemas import (
    CustomerContext,
    PolicyContext,
    RuntimeOptions,
    RuntimeValidationError,
    TenantContext,
)
from service.request_parsing import parse_runtime_request


def _minimal_payload(**overrides) -> dict:
    payload = {
        "tenant_id": "ten_1",
        "ticket_id": "tkt_1",
        "conversation_id": "cnv_1",
        "correlation_id": "corr_1",
        "messages": [{"role": "customer", "content": "Where is my order #A1001?"}],
    }
    payload.update(overrides)
    return payload


def _full_payload() -> dict:
    return _minimal_payload(
        messages=[
            {"role": "customer", "content": "Refund order A1001 please.", "is_internal": False},
            {"role": "agent", "content": "internal triage note", "is_internal": True},
        ],
        customer={
            "customer_id": "cus_1",
            "email": "a@x.com",
            "display_name": "Ada",
            "tier": "vip",
            "locale": "en-GB",
        },
        tenant={"brand_name": "Acme Goods", "tone": "friendly", "timezone": "Europe/London"},
        policy={
            "auto_send_allowed_topics": ["faq"],
            "active_policy_version_ids": ["polv_1", "polv_2"],
        },
        options={"allow_auto_send": True, "max_tool_calls": 3, "max_retrieved_chunks": 5},
        ai_run_type="classification",
    )


class FullPayloadTest(unittest.TestCase):
    def test_parses_every_field(self) -> None:
        request = parse_runtime_request(_full_payload())
        self.assertEqual(request.tenant_id, "ten_1")
        self.assertEqual(request.ticket_id, "tkt_1")
        self.assertEqual(request.conversation_id, "cnv_1")
        self.assertEqual(request.correlation_id, "corr_1")
        self.assertEqual(len(request.messages), 2)
        self.assertEqual(request.messages[0].role, "customer")
        self.assertFalse(request.messages[0].is_internal)
        self.assertTrue(request.messages[1].is_internal)
        self.assertEqual(request.customer.customer_id, "cus_1")
        self.assertEqual(request.customer.tier, "vip")
        self.assertEqual(request.customer.locale, "en-GB")
        self.assertEqual(request.tenant.brand_name, "Acme Goods")
        self.assertEqual(request.tenant.timezone, "Europe/London")
        self.assertEqual(request.policy.auto_send_allowed_topics, ("faq",))
        self.assertEqual(request.policy.active_policy_version_ids, ("polv_1", "polv_2"))
        self.assertTrue(request.options.allow_auto_send)
        self.assertEqual(request.options.max_tool_calls, 3)
        self.assertEqual(request.options.max_retrieved_chunks, 5)
        self.assertEqual(request.ai_run_type, "classification")

    def test_lists_become_tuples(self) -> None:
        request = parse_runtime_request(_full_payload())
        self.assertIsInstance(request.messages, tuple)
        self.assertIsInstance(request.policy.auto_send_allowed_topics, tuple)
        self.assertIsInstance(request.policy.active_policy_version_ids, tuple)


class MinimalPayloadTest(unittest.TestCase):
    def test_omitted_sections_take_runtime_defaults(self) -> None:
        request = parse_runtime_request(_minimal_payload())
        self.assertEqual(request.customer, CustomerContext())
        self.assertEqual(request.tenant, TenantContext())
        self.assertEqual(request.policy, PolicyContext())
        self.assertEqual(request.options, RuntimeOptions())
        self.assertEqual(request.ai_run_type, "full_graph")
        self.assertFalse(request.messages[0].is_internal)  # default

    def test_omitted_sub_object_fields_take_runtime_defaults(self) -> None:
        request = parse_runtime_request(
            _minimal_payload(customer={"customer_id": "cus_9"}, options={"max_tool_calls": 1})
        )
        self.assertEqual(request.customer.customer_id, "cus_9")
        self.assertEqual(request.customer.tier, "standard")
        self.assertEqual(request.options.max_tool_calls, 1)
        self.assertFalse(request.options.allow_auto_send)
        self.assertEqual(request.options.max_retrieved_chunks, 8)

    def test_parsed_request_passes_runtime_validation(self) -> None:
        parse_runtime_request(_minimal_payload()).validate()


class UnknownKeyTest(unittest.TestCase):
    def test_unknown_keys_rejected_at_every_level(self) -> None:
        rejected = (
            _minimal_payload(bogus=1),
            _minimal_payload(messages=[{"role": "customer", "content": "hi", "bogus": 1}]),
            _minimal_payload(customer={"bogus": 1}),
            _minimal_payload(tenant={"bogus": 1}),
            _minimal_payload(policy={"bogus": 1}),
            _minimal_payload(options={"bogus": 1}),
        )
        for payload in rejected:
            with self.assertRaises(RuntimeValidationError) as ctx:
                parse_runtime_request(payload)
            self.assertIn("bogus", str(ctx.exception))


class TypeErrorTest(unittest.TestCase):
    def test_body_must_be_object(self) -> None:
        for payload in (None, [], "x", 7):
            with self.assertRaises(RuntimeValidationError):
                parse_runtime_request(payload)

    def test_required_ids_must_be_non_empty_strings(self) -> None:
        for key in ("tenant_id", "ticket_id", "conversation_id", "correlation_id"):
            with self.assertRaises(RuntimeValidationError) as ctx:
                parse_runtime_request(_minimal_payload(**{key: ""}))
            self.assertIn(key, str(ctx.exception))
            with self.assertRaises(RuntimeValidationError):
                parse_runtime_request(_minimal_payload(**{key: 42}))

    def test_messages_shape_errors(self) -> None:
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(messages="not a list"))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(messages=[]))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(messages=["not an object"]))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(messages=[{"role": "robot", "content": "x"}]))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(messages=[{"role": "customer", "content": 3}]))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(
                _minimal_payload(messages=[{"role": "customer", "content": "x", "is_internal": "no"}])
            )

    def test_sub_object_field_type_errors(self) -> None:
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(customer={"tier": "gold"}))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(customer={"customer_id": ""}))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(tenant={"brand_name": 5}))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(policy={"auto_send_allowed_topics": "faq"}))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(policy={"auto_send_allowed_topics": ["faq", 1]}))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(options={"allow_auto_send": "yes"}))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(options={"max_tool_calls": True}))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(options={"max_tool_calls": -1}))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(options={"max_retrieved_chunks": 0}))
        with self.assertRaises(RuntimeValidationError):
            parse_runtime_request(_minimal_payload(ai_run_type="not_a_run_type"))

    def test_null_customer_fields_allowed(self) -> None:
        request = parse_runtime_request(
            _minimal_payload(
                customer={
                    "customer_id": None,
                    "email": None,
                    "display_name": None,
                    "tier": "standard",
                    "locale": None,
                }
            )
        )
        self.assertIsNone(request.customer.customer_id)


class MissingFieldMessageTest(unittest.TestCase):
    def test_missing_field_messages_name_the_field(self) -> None:
        cases = {
            "tenant_id": {k: v for k, v in _minimal_payload().items() if k != "tenant_id"},
            "messages": {k: v for k, v in _minimal_payload().items() if k != "messages"},
        }
        for field_name, payload in cases.items():
            with self.assertRaises(RuntimeValidationError) as ctx:
                parse_runtime_request(payload)
            self.assertIn(field_name, str(ctx.exception))

    def test_missing_message_fields_name_the_path(self) -> None:
        with self.assertRaises(RuntimeValidationError) as ctx:
            parse_runtime_request(_minimal_payload(messages=[{"content": "x"}]))
        self.assertIn("messages[0].role", str(ctx.exception))
        with self.assertRaises(RuntimeValidationError) as ctx:
            parse_runtime_request(_minimal_payload(messages=[{"role": "customer"}]))
        self.assertIn("messages[0].content", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
