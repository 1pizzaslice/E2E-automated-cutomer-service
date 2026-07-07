import unittest

from runtime.llm import (
    CLASSIFIER_OUTPUT_SCHEMA,
    COMPOSER_OUTPUT_SCHEMA,
    LangChainSupportModel,
    LlmConfigError,
    LlmOutputError,
    ScriptedSupportChatModel,
    SCRIPTED_MODEL_ID,
    SCRIPTED_PROVIDER,
    build_model_provider,
    load_llm_config,
    render_input_block,
)
from runtime.prompts import KNOWN_PROMPT_IDS, PromptNotFoundError, load_prompt
from runtime.providers import (
    PROMPT_CLASSIFIER,
    PROMPT_COMPOSER,
    DeterministicSupportModel,
    ModelRequest,
)
from runtime.runner import run_support_graph
from runtime.schemas import Message, RuntimeRequest


class LlmConfigTest(unittest.TestCase):
    def test_unset_provider_is_deterministic_default(self) -> None:
        config = load_llm_config({})
        self.assertIsNone(config.provider)
        self.assertFalse(config.configured)

    def test_deterministic_provider_string_is_default(self) -> None:
        config = load_llm_config({"SUPPORT_LLM_PROVIDER": "deterministic"})
        self.assertIsNone(config.provider)

    def test_anthropic_requires_model_and_key(self) -> None:
        with self.assertRaises(LlmConfigError) as ctx:
            load_llm_config({"SUPPORT_LLM_PROVIDER": "anthropic"})
        message = str(ctx.exception)
        self.assertIn("SUPPORT_LLM_MODEL is required", message)
        self.assertIn("ANTHROPIC_API_KEY", message)

    def test_anthropic_with_model_and_key_is_valid(self) -> None:
        config = load_llm_config(
            {
                "SUPPORT_LLM_PROVIDER": "anthropic",
                "SUPPORT_LLM_MODEL": "claude-opus-4-8",
                "ANTHROPIC_API_KEY": "sk-ant-test",
            }
        )
        self.assertEqual(config.provider, "anthropic")
        self.assertEqual(config.model, "claude-opus-4-8")
        self.assertEqual(config.api_key, "sk-ant-test")

    def test_openai_key_resolves_through_default_ref(self) -> None:
        config = load_llm_config(
            {
                "SUPPORT_LLM_PROVIDER": "openai",
                "SUPPORT_LLM_MODEL": "gpt-4o",
                "OPENAI_API_KEY": "sk-oai-test",
            }
        )
        self.assertEqual(config.api_key, "sk-oai-test")

    def test_custom_key_ref_is_validated_and_resolved(self) -> None:
        config = load_llm_config(
            {
                "SUPPORT_LLM_PROVIDER": "anthropic",
                "SUPPORT_LLM_MODEL": "claude-opus-4-8",
                "SUPPORT_LLM_API_KEY_REF": "MY_CLAUDE_KEY",
                "MY_CLAUDE_KEY": "sk-custom",
            }
        )
        self.assertEqual(config.api_key, "sk-custom")

        with self.assertRaises(LlmConfigError):
            load_llm_config(
                {
                    "SUPPORT_LLM_PROVIDER": "anthropic",
                    "SUPPORT_LLM_MODEL": "claude-opus-4-8",
                    "SUPPORT_LLM_API_KEY_REF": "not-a-ref",
                }
            )

    def test_scripted_needs_no_model_or_key(self) -> None:
        config = load_llm_config({"SUPPORT_LLM_PROVIDER": "scripted"})
        self.assertEqual(config.provider, SCRIPTED_PROVIDER)
        self.assertEqual(config.model, SCRIPTED_MODEL_ID)

    def test_numeric_options_are_validated(self) -> None:
        with self.assertRaises(LlmConfigError) as ctx:
            load_llm_config(
                {
                    "SUPPORT_LLM_PROVIDER": "scripted",
                    "SUPPORT_LLM_TIMEOUT_MS": "zero",
                    "SUPPORT_LLM_MAX_RETRIES": "-1",
                    "SUPPORT_LLM_TEMPERATURE": "warm",
                }
            )
        message = str(ctx.exception)
        self.assertIn("SUPPORT_LLM_TIMEOUT_MS", message)
        self.assertIn("SUPPORT_LLM_MAX_RETRIES", message)
        self.assertIn("SUPPORT_LLM_TEMPERATURE", message)


class PromptRegistryTest(unittest.TestCase):
    def test_known_prompts_load_with_matching_frontmatter(self) -> None:
        for prompt_id in KNOWN_PROMPT_IDS:
            template = load_prompt(prompt_id)
            self.assertEqual(template.prompt_id, prompt_id)
            self.assertEqual(template.version, "v1")
            self.assertTrue(template.body)
            # Frontmatter is stripped from the rendered instructions.
            self.assertNotIn("---", template.body.split("\n")[0])

    def test_unknown_prompt_id_fails_loudly(self) -> None:
        with self.assertRaises(PromptNotFoundError):
            load_prompt("support_classifier.v99")

    def test_prompts_exist_for_both_model_call_sites(self) -> None:
        self.assertIn(PROMPT_CLASSIFIER, KNOWN_PROMPT_IDS)
        self.assertIn(PROMPT_COMPOSER, KNOWN_PROMPT_IDS)


class ScriptedProviderTest(unittest.TestCase):
    """The scripted chat model drives the exact LangChain adapter code path."""

    def _adapter(self) -> LangChainSupportModel:
        return LangChainSupportModel(
            chat_model=ScriptedSupportChatModel(),
            provider_name=SCRIPTED_PROVIDER,
            model_id=SCRIPTED_MODEL_ID,
        )

    def test_classifier_call_matches_deterministic_rules(self) -> None:
        payload = {"text": "i want a refund for order #a1001", "customer_tier": "standard"}
        adapter_out = self._adapter().invoke(
            ModelRequest(PROMPT_CLASSIFIER, "v1", payload)
        )
        rules_out = DeterministicSupportModel().invoke(
            ModelRequest(PROMPT_CLASSIFIER, "v1", payload)
        )
        self.assertEqual(adapter_out.output, rules_out.output)
        self.assertEqual(adapter_out.metadata.provider, SCRIPTED_PROVIDER)
        self.assertEqual(adapter_out.metadata.model_id, SCRIPTED_MODEL_ID)
        self.assertGreater(adapter_out.metadata.prompt_tokens, 0)
        self.assertGreater(adapter_out.metadata.completion_tokens, 0)

    def test_composer_output_matches_schema_fields(self) -> None:
        payload = {
            "topic": "faq",
            "brand_name": "Acme Goods",
            "tone": "helpful_professional",
            "evidence": [],
            "tool_results": [],
        }
        response = self._adapter().invoke(ModelRequest(PROMPT_COMPOSER, "v1", payload))
        self.assertEqual(set(response.output), set(COMPOSER_OUTPUT_SCHEMA["required"]))
        self.assertTrue(response.output["draft_text"])

    def test_unknown_prompt_id_raises_output_error(self) -> None:
        with self.assertRaises(LlmOutputError):
            self._adapter().invoke(ModelRequest("support_unknown.v1", "v1", {}))

    def test_full_graph_run_on_scripted_provider_carries_usage(self) -> None:
        request = RuntimeRequest(
            tenant_id="ten_1",
            ticket_id="tkt_1",
            conversation_id="cnv_1",
            correlation_id="corr_1",
            messages=(Message("customer", "How long does shipping take?"),),
        )
        result, _trace = run_support_graph(request, model=self._adapter())
        self.assertEqual(result.status, "succeeded")
        assert result.model is not None
        self.assertEqual(result.model["provider"], SCRIPTED_PROVIDER)
        self.assertEqual(result.model["model_id"], SCRIPTED_MODEL_ID)
        self.assertEqual(result.model["calls"], 2)  # classifier + composer
        self.assertEqual(
            result.model["prompt_versions"],
            {PROMPT_CLASSIFIER: "v1", PROMPT_COMPOSER: "v1"},
        )
        self.assertGreater(result.model["input_tokens"], 0)
        self.assertGreater(result.model["output_tokens"], 0)

    def test_deterministic_run_reports_deterministic_model_section(self) -> None:
        request = RuntimeRequest(
            tenant_id="ten_1",
            ticket_id="tkt_1",
            conversation_id="cnv_1",
            correlation_id="corr_1",
            messages=(Message("customer", "Where is my order #A1001?"),),
        )
        first, _ = run_support_graph(request)
        second, _ = run_support_graph(request)
        assert first.model is not None
        self.assertEqual(first.model, second.model)  # reproducible
        self.assertEqual(first.model["provider"], "deterministic")
        self.assertEqual(first.model["model_id"], "deterministic-support-v1")
        self.assertEqual(first.model["cost_estimate"], 0.0)


class _FlakyThenValidChat:
    """First structured call fails to parse; second succeeds."""

    def __init__(self) -> None:
        self.calls = 0

    def with_structured_output(self, schema, *, include_raw: bool = False):
        outer = self

        class _Runnable:
            def invoke(self, messages):
                outer.calls += 1
                if outer.calls == 1:
                    return {
                        "raw": type("R", (), {"id": "req_1", "usage_metadata": {"input_tokens": 10, "output_tokens": 0}})(),
                        "parsed": None,
                        "parsing_error": ValueError("bad json"),
                    }
                return {
                    "raw": type("R", (), {"id": "req_2", "usage_metadata": {"input_tokens": 10, "output_tokens": 5}})(),
                    "parsed": {
                        "topic": "faq",
                        "subtopic": None,
                        "language": "en",
                        "sentiment": "neutral",
                        "urgency": "normal",
                        "priority": "p3",
                        "sensitive_flags": [],
                        "confidence": 0.8,
                        "reasoning_summary": "faq",
                    },
                    "parsing_error": None,
                }

        return _Runnable()


class _AlwaysInvalidChat:
    def with_structured_output(self, schema, *, include_raw: bool = False):
        class _Runnable:
            def invoke(self, messages):
                return {"raw": None, "parsed": None, "parsing_error": ValueError("nope")}

        return _Runnable()


class AdapterRetryTest(unittest.TestCase):
    def test_parse_failure_retries_once_and_accumulates_usage(self) -> None:
        chat = _FlakyThenValidChat()
        adapter = LangChainSupportModel(chat_model=chat, provider_name="test", model_id="test-model")
        response = adapter.invoke(
            ModelRequest(PROMPT_CLASSIFIER, "v1", {"text": "hi", "customer_tier": "standard"})
        )
        self.assertEqual(chat.calls, 2)
        self.assertEqual(response.output["topic"], "faq")
        # Usage from both attempts is captured.
        self.assertEqual(response.metadata.prompt_tokens, 20)
        self.assertEqual(response.metadata.completion_tokens, 5)

    def test_persistent_parse_failure_raises(self) -> None:
        adapter = LangChainSupportModel(
            chat_model=_AlwaysInvalidChat(), provider_name="test", model_id="test-model"
        )
        with self.assertRaises(LlmOutputError):
            adapter.invoke(
                ModelRequest(PROMPT_CLASSIFIER, "v1", {"text": "hi", "customer_tier": "standard"})
            )


class CostEstimateTest(unittest.TestCase):
    def test_known_model_prefix_uses_builtin_prices(self) -> None:
        adapter = LangChainSupportModel(
            chat_model=ScriptedSupportChatModel(),
            provider_name="anthropic",
            model_id="claude-opus-4-8",
        )
        # 1M input + 1M output at $5/$25 per MTok.
        self.assertEqual(adapter._cost(1_000_000, 1_000_000), 30.0)

    def test_explicit_prices_override_table(self) -> None:
        adapter = LangChainSupportModel(
            chat_model=ScriptedSupportChatModel(),
            provider_name="anthropic",
            model_id="claude-opus-4-8",
            price_input_per_mtok=1.0,
            price_output_per_mtok=2.0,
        )
        self.assertEqual(adapter._cost(1_000_000, 1_000_000), 3.0)

    def test_unknown_model_estimates_zero(self) -> None:
        adapter = LangChainSupportModel(
            chat_model=ScriptedSupportChatModel(),
            provider_name="other",
            model_id="mystery-model",
        )
        self.assertEqual(adapter._cost(1_000_000, 1_000_000), 0.0)


class BuildModelProviderTest(unittest.TestCase):
    def test_unconfigured_returns_deterministic(self) -> None:
        provider = build_model_provider(load_llm_config({}))
        self.assertIsInstance(provider, DeterministicSupportModel)

    def test_scripted_returns_langchain_adapter(self) -> None:
        provider = build_model_provider(load_llm_config({"SUPPORT_LLM_PROVIDER": "scripted"}))
        self.assertIsInstance(provider, LangChainSupportModel)
        self.assertEqual(provider.provider_name, SCRIPTED_PROVIDER)


class SchemaVocabularyTest(unittest.TestCase):
    def test_classifier_priority_enum_is_platform_vocabulary_without_p0(self) -> None:
        enum = CLASSIFIER_OUTPUT_SCHEMA["properties"]["priority"]["enum"]
        self.assertEqual(enum, ["p1", "p2", "p3"])  # p0 reserved for operators

    def test_input_block_round_trips(self) -> None:
        payload = {"text": "hello", "customer_tier": "vip"}
        block = render_input_block(payload)
        self.assertIn('"customer_tier"', block)
        self.assertTrue(block.startswith("```json\n"))


if __name__ == "__main__":
    unittest.main()
