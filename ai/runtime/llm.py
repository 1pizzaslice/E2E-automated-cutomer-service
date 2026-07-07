"""Config-driven real-model ``ModelProvider`` over LangChain (Milestone 15).

ADR-0020 fixes the provider mechanism: the Python ``ModelProvider`` port is
implemented over LangChain's ``init_chat_model`` with the provider and model
selected by environment variables — a provider swap is a config change plus an
eval-gate re-run, never a code change. This module contains:

* :func:`load_llm_config` — the stdlib env-config loader
  (``SUPPORT_LLM_PROVIDER`` / ``SUPPORT_LLM_MODEL`` + key refs per the
  SecretResolver conventions). The deterministic offline model remains the
  default; a real provider activates only by explicit configuration.
* :class:`LangChainSupportModel` — the adapter behind the unchanged
  ``ModelProvider`` port: renders the versioned prompt files
  (``runtime.prompts``), enforces structured outputs via
  ``with_structured_output`` (JSON schema with closed vocabularies), applies
  per-call timeouts and bounded retries, and captures token usage, latency,
  and a cost estimate into :class:`~runtime.providers.ModelMetadata`.
* :class:`ScriptedSupportChatModel` — a dependency-free stand-in chat model
  selected with ``SUPPORT_LLM_PROVIDER=scripted``. It drives the exact same
  adapter code path (prompt rendering → chat model → structured output →
  validation) with deterministic outputs, which is what proves provider
  agnosticism offline: switching between it and a real provider is env-only.

LangChain itself is imported lazily inside :func:`create_chat_model`, so this
module stays importable in the dependency-free harness runs; the real stack
installs with ``uv sync --project ai --extra llm``.

Failure semantics (harness section 16): any provider/transport/validation
error raises out of ``invoke``; ``run_support_graph`` converts it into a
structured ``failed`` result that routes the ticket to a human. Nothing here
ever fabricates model output after an error.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional

from .prompts import load_prompt
from .providers import (
    PROMPT_CLASSIFIER,
    PROMPT_COMPOSER,
    DeterministicSupportModel,
    ModelMetadata,
    ModelProvider,
    ModelRequest,
    ModelResponse,
)
from .schemas import RISK_LEVELS, SENSITIVE_FLAGS, SENTIMENTS, TOPICS, URGENCIES
from .tracing import deterministic_id

# Mirror of SECRET_REF_PATTERN in packages/integrations/src/secrets.ts (and
# ai/service/config.py): a secret reference names an environment variable.
_SECRET_REF_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")

# Providers whose API-key environment variable we require at config time so a
# misconfigured deployment fails at boot instead of on the first ticket. Other
# init_chat_model providers resolve credentials through their own SDK
# conventions and are passed through as-is.
_DEFAULT_API_KEY_REFS: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
}

# Built-in USD prices per million tokens (input, output) used for the
# ``ai_runs.cost_estimate`` capture; override per deployment with
# SUPPORT_LLM_PRICE_INPUT_PER_MTOK / SUPPORT_LLM_PRICE_OUTPUT_PER_MTOK.
# Matched by model-id prefix; unknown models estimate 0 until configured.
_DEFAULT_PRICES_PER_MTOK: tuple[tuple[str, float, float], ...] = (
    ("claude-opus-4-8", 5.0, 25.0),
    ("claude-opus-4-7", 5.0, 25.0),
    ("claude-opus-4-6", 5.0, 25.0),
    ("claude-sonnet-5", 3.0, 15.0),
    ("claude-sonnet-4-6", 3.0, 15.0),
    ("claude-haiku-4-5", 1.0, 5.0),
    ("gpt-4o-mini", 0.15, 0.6),
    ("gpt-4o", 2.5, 10.0),
)

_DEFAULT_TIMEOUT_MS = 30_000
_DEFAULT_MAX_RETRIES = 2
# Structured-output parse retries (per call, in-adapter) on top of the SDK's
# transport retries: one repair attempt keeps a flaky JSON emission from
# failing the whole run, while a persistently non-conforming model still
# surfaces as a structured failure.
_PARSE_ATTEMPTS = 2

SCRIPTED_PROVIDER = "scripted"
SCRIPTED_MODEL_ID = "scripted-support-v1"


class LlmConfigError(ValueError):
    """Raised when the LLM environment configuration is invalid."""


class LlmOutputError(RuntimeError):
    """Raised when the provider cannot produce schema-conforming output."""


@dataclass(frozen=True)
class LlmConfig:
    """Validated real-model configuration. ``provider is None`` means the
    deterministic offline model (the default)."""

    provider: Optional[str]
    model: Optional[str]
    api_key: Optional[str]
    timeout_ms: int = _DEFAULT_TIMEOUT_MS
    max_retries: int = _DEFAULT_MAX_RETRIES
    temperature: Optional[float] = None
    price_input_per_mtok: Optional[float] = None
    price_output_per_mtok: Optional[float] = None

    @property
    def configured(self) -> bool:
        return self.provider is not None


def collect_llm_config(env: Mapping[str, str], errors: list[str]) -> LlmConfig:
    """Parse the LLM env configuration, appending problems to ``errors``."""

    provider = (env.get("SUPPORT_LLM_PROVIDER") or "").strip().lower() or None
    if provider == "deterministic":
        provider = None

    model = (env.get("SUPPORT_LLM_MODEL") or "").strip() or None
    api_key: Optional[str] = None

    if provider is not None:
        if provider == SCRIPTED_PROVIDER:
            model = model or SCRIPTED_MODEL_ID
        elif model is None:
            errors.append(
                "SUPPORT_LLM_MODEL is required when SUPPORT_LLM_PROVIDER is set "
                "(real providers activate only by explicit config)"
            )

        default_ref = _DEFAULT_API_KEY_REFS.get(provider)
        ref = env.get("SUPPORT_LLM_API_KEY_REF", default_ref or "")
        if ref:
            if not _SECRET_REF_PATTERN.match(ref):
                errors.append(
                    f"SUPPORT_LLM_API_KEY_REF must match {_SECRET_REF_PATTERN.pattern} "
                    f"(it names an environment variable), got {ref!r}"
                )
            else:
                api_key = env.get(ref) or None
                if api_key is None and provider in _DEFAULT_API_KEY_REFS:
                    errors.append(
                        f"secret {ref} (referenced by SUPPORT_LLM_API_KEY_REF) is required "
                        f"for SUPPORT_LLM_PROVIDER={provider} but not set"
                    )

    timeout_ms = _parse_positive_int(
        env, "SUPPORT_LLM_TIMEOUT_MS", _DEFAULT_TIMEOUT_MS, errors
    )
    max_retries = _parse_non_negative_int(
        env, "SUPPORT_LLM_MAX_RETRIES", _DEFAULT_MAX_RETRIES, errors
    )
    temperature = _parse_optional_float(env, "SUPPORT_LLM_TEMPERATURE", errors)
    price_in = _parse_optional_float(env, "SUPPORT_LLM_PRICE_INPUT_PER_MTOK", errors)
    price_out = _parse_optional_float(env, "SUPPORT_LLM_PRICE_OUTPUT_PER_MTOK", errors)

    return LlmConfig(
        provider=provider,
        model=model,
        api_key=api_key,
        timeout_ms=timeout_ms,
        max_retries=max_retries,
        temperature=temperature,
        price_input_per_mtok=price_in,
        price_output_per_mtok=price_out,
    )


def load_llm_config(env: Mapping[str, str]) -> LlmConfig:
    """Load and validate the LLM configuration, raising on any problem."""

    errors: list[str] = []
    config = collect_llm_config(env, errors)
    if errors:
        raise LlmConfigError(
            "invalid LLM provider configuration:\n" + "\n".join(f"- {e}" for e in errors)
        )
    return config


def _parse_positive_int(
    env: Mapping[str, str], name: str, default: int, errors: list[str]
) -> int:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
        if value <= 0:
            raise ValueError
        return value
    except ValueError:
        errors.append(f"{name} must be a positive integer, got {raw!r}")
        return default


def _parse_non_negative_int(
    env: Mapping[str, str], name: str, default: int, errors: list[str]
) -> int:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
        if value < 0:
            raise ValueError
        return value
    except ValueError:
        errors.append(f"{name} must be a non-negative integer, got {raw!r}")
        return default


def _parse_optional_float(
    env: Mapping[str, str], name: str, errors: list[str]
) -> Optional[float]:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        errors.append(f"{name} must be a number, got {raw!r}")
        return None


# --- Structured output schemas -------------------------------------------------

# The classifier must speak the platform priority vocabulary (p0 is reserved
# for operator-declared incidents, so the model never emits it).
_MODEL_PRIORITIES = ("p1", "p2", "p3")

CLASSIFIER_OUTPUT_SCHEMA: dict[str, Any] = {
    "title": "support_classification",
    "description": "Structured classification of one customer conversation.",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "topic",
        "subtopic",
        "language",
        "sentiment",
        "urgency",
        "priority",
        "sensitive_flags",
        "confidence",
        "reasoning_summary",
    ],
    "properties": {
        "topic": {"type": "string", "enum": list(TOPICS)},
        "subtopic": {"type": ["string", "null"]},
        "language": {"type": "string"},
        "sentiment": {"type": "string", "enum": list(SENTIMENTS)},
        "urgency": {"type": "string", "enum": list(URGENCIES)},
        "priority": {"type": "string", "enum": list(_MODEL_PRIORITIES)},
        "sensitive_flags": {
            "type": "array",
            "items": {"type": "string", "enum": list(SENSITIVE_FLAGS)},
        },
        "confidence": {"type": "number"},
        "reasoning_summary": {"type": "string"},
    },
}

COMPOSER_OUTPUT_SCHEMA: dict[str, Any] = {
    "title": "support_reply_draft",
    "description": "One customer-support reply draft with its grounding.",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "draft_text",
        "customer_language",
        "tone",
        "evidence",
        "risk_level",
        "confidence",
    ],
    "properties": {
        "draft_text": {"type": "string"},
        "customer_language": {"type": "string"},
        "tone": {"type": "string"},
        "evidence": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "ref_id", "summary"],
                "properties": {
                    "type": {"type": "string", "enum": ["kb_chunk", "policy"]},
                    "ref_id": {"type": "string"},
                    "summary": {"type": "string"},
                },
            },
        },
        "risk_level": {"type": "string", "enum": list(RISK_LEVELS)},
        "confidence": {"type": "number"},
    },
}

_OUTPUT_SCHEMAS: dict[str, dict[str, Any]] = {
    PROMPT_CLASSIFIER: CLASSIFIER_OUTPUT_SCHEMA,
    PROMPT_COMPOSER: COMPOSER_OUTPUT_SCHEMA,
}


def _clamp_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.5
    return min(1.0, max(0.0, confidence))


def normalize_model_output(prompt_id: str, request_input: Mapping[str, Any], parsed: dict[str, Any]) -> dict[str, Any]:
    """Deterministic post-parse normalization of real-model output.

    Provider tool-calling does not hard-enforce nested schema enums, so the
    adapter enforces the invariants that matter deterministically instead of
    trusting the model: composer citations may only reference evidence that
    was actually provided (a hallucinated ref_id is dropped, never surfaced),
    their `type` is derived from the cited document's real `document_type`
    rather than the model's claim, and confidences are clamped to [0, 1] so a
    numeric excursion degrades to a validation-safe value instead of failing
    the run. A conforming output passes through unchanged.
    """

    normalized = dict(parsed)
    normalized["confidence"] = _clamp_confidence(parsed.get("confidence"))

    if prompt_id != PROMPT_COMPOSER:
        return normalized

    provided: dict[str, str] = {}
    for item in request_input.get("evidence") or []:
        if isinstance(item, Mapping):
            ref_id = str(item.get("ref_id") or "")
            if ref_id:
                provided[ref_id] = str(item.get("document_type") or "")

    citations: list[dict[str, Any]] = []
    for item in parsed.get("evidence") or []:
        if not isinstance(item, Mapping):
            continue
        ref_id = str(item.get("ref_id") or "")
        if ref_id not in provided:
            continue  # only provided evidence may be cited
        declared = item.get("type")
        if declared not in ("kb_chunk", "policy"):
            declared = "policy" if provided[ref_id] == "policy" else "kb_chunk"
        citations.append(
            {"type": declared, "ref_id": ref_id, "summary": str(item.get("summary") or "")}
        )
    normalized["evidence"] = citations

    return normalized


def render_input_block(payload: Mapping[str, Any]) -> str:
    """Render the machine-readable input block appended to every prompt.

    Deterministic serialization (sorted keys) keeps runs reproducible and lets
    the scripted stand-in parse the exact payload back out — which is also the
    contract that keeps customer text *data*: it is always inside this fenced
    JSON block, never interpolated into the instructions.
    """

    return "```json\n" + json.dumps(payload, sort_keys=True, ensure_ascii=False, indent=2) + "\n```"


def _extract_input_block(text: str) -> dict[str, Any]:
    match = re.search(r"```json\n(.*?)\n```", text, re.S)
    if not match:
        raise ValueError("no machine-readable input block found in prompt")
    return json.loads(match.group(1))


class ScriptedSupportChatModel:
    """Dependency-free chat model driving the same adapter path as LangChain.

    It implements the two members :class:`LangChainSupportModel` uses —
    ``with_structured_output(schema, include_raw=True)`` returning an object
    with ``invoke(messages)`` — and answers by parsing the input block out of
    the rendered prompt and running the deterministic support rules on it.
    Because the adapter cannot tell it apart from a real chat model, a suite
    that passes under ``SUPPORT_LLM_PROVIDER=scripted`` proves the whole
    provider path (prompt files, structured outputs, usage capture) with only
    env changes.
    """

    def with_structured_output(self, schema: dict[str, Any], *, include_raw: bool = False):
        if not include_raw:  # the adapter always asks for usage metadata
            raise ValueError("ScriptedSupportChatModel requires include_raw=True")
        return _ScriptedStructuredRunnable(schema)


class _ScriptedRawMessage:
    def __init__(self, request_text: str, output: dict[str, Any]) -> None:
        self.id = deterministic_id("scripted", request_text)
        self.usage_metadata = {
            "input_tokens": len(request_text) // 4,
            "output_tokens": len(json.dumps(output, sort_keys=True)) // 4,
        }


class _ScriptedStructuredRunnable:
    def __init__(self, schema: dict[str, Any]) -> None:
        self._schema = schema
        self._rules = DeterministicSupportModel()

    def invoke(self, messages: list[tuple[str, str]]) -> dict[str, Any]:
        human_text = "\n".join(content for role, content in messages if role == "human")
        payload = _extract_input_block(human_text)

        if self._schema is CLASSIFIER_OUTPUT_SCHEMA:
            output = self._rules._classify(payload)
        elif self._schema is COMPOSER_OUTPUT_SCHEMA:
            composed = self._rules._compose(payload)
            output = {key: composed[key] for key in COMPOSER_OUTPUT_SCHEMA["required"]}
        else:  # pragma: no cover - guarded by _OUTPUT_SCHEMAS
            raise ValueError("unknown structured output schema")

        request_text = "\n".join(content for _role, content in messages)
        return {
            "raw": _ScriptedRawMessage(request_text, output),
            "parsed": output,
            "parsing_error": None,
        }


def create_chat_model(config: LlmConfig) -> Any:
    """Build the underlying chat model for a configured provider."""

    if config.provider is None:
        raise LlmConfigError("no LLM provider configured")

    if config.provider == SCRIPTED_PROVIDER:
        return ScriptedSupportChatModel()

    # Imported lazily: the real stack is the uv `llm` extra (ADR-0016/0020);
    # everything else in this module runs on the standard library.
    from langchain.chat_models import init_chat_model

    kwargs: dict[str, Any] = {
        "model_provider": config.provider,
        "timeout": config.timeout_ms / 1000.0,
        "max_retries": config.max_retries,
    }
    if config.api_key is not None:
        kwargs["api_key"] = config.api_key
    # Current Claude models reject non-default sampling parameters, so the
    # temperature is only sent when explicitly configured.
    if config.temperature is not None:
        kwargs["temperature"] = config.temperature

    return init_chat_model(config.model, **kwargs)


@dataclass
class LangChainSupportModel:
    """``ModelProvider`` adapter over a LangChain-style chat model."""

    chat_model: Any
    provider_name: str
    model_id: str
    price_input_per_mtok: Optional[float] = None
    price_output_per_mtok: Optional[float] = None
    _structured: dict[str, Any] = field(default_factory=dict, repr=False)

    def invoke(self, request: ModelRequest) -> ModelResponse:
        schema = _OUTPUT_SCHEMAS.get(request.prompt_id)
        if schema is None:
            raise LlmOutputError(f"unknown prompt_id {request.prompt_id!r}")

        template = load_prompt(request.prompt_id)
        messages = [
            ("system", template.body),
            ("human", render_input_block(request.input)),
        ]

        runnable = self._structured.get(request.prompt_id)
        if runnable is None:
            runnable = self.chat_model.with_structured_output(schema, include_raw=True)
            self._structured[request.prompt_id] = runnable

        started = time.monotonic()
        prompt_tokens = 0
        completion_tokens = 0
        request_id = ""
        parsed: Optional[dict[str, Any]] = None
        last_error: Optional[Exception] = None

        for _attempt in range(_PARSE_ATTEMPTS):
            result = runnable.invoke(messages)
            raw = result.get("raw")
            usage = getattr(raw, "usage_metadata", None) or {}
            prompt_tokens += int(usage.get("input_tokens") or 0)
            completion_tokens += int(usage.get("output_tokens") or 0)
            request_id = str(getattr(raw, "id", "") or request_id)

            parsing_error = result.get("parsing_error")
            candidate = result.get("parsed")
            if parsing_error is None and isinstance(candidate, dict):
                parsed = candidate
                break
            last_error = parsing_error or ValueError("model returned no parsed output")

        if parsed is None:
            raise LlmOutputError(
                f"model output failed structured-output parsing for {request.prompt_id}: {last_error}"
            )

        parsed = normalize_model_output(request.prompt_id, request.input, parsed)

        latency_ms = int((time.monotonic() - started) * 1000)
        metadata = ModelMetadata(
            provider=self.provider_name,
            model_id=self.model_id,
            request_id=request_id,
            latency_ms=latency_ms,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_estimate=self._cost(prompt_tokens, completion_tokens),
        )
        return ModelResponse(output=parsed, metadata=metadata)

    def _cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        price_in = self.price_input_per_mtok
        price_out = self.price_output_per_mtok
        if price_in is None or price_out is None:
            for prefix, table_in, table_out in _DEFAULT_PRICES_PER_MTOK:
                if self.model_id.startswith(prefix):
                    price_in = table_in if price_in is None else price_in
                    price_out = table_out if price_out is None else price_out
                    break
        if price_in is None and price_out is None:
            return 0.0
        return round(
            (prompt_tokens * (price_in or 0.0) + completion_tokens * (price_out or 0.0))
            / 1_000_000,
            6,
        )


def build_model_provider(config: LlmConfig) -> ModelProvider:
    """Resolve the configured ``ModelProvider``.

    Unset/``deterministic`` keeps the offline default; ``scripted`` and every
    real ``init_chat_model`` provider share :class:`LangChainSupportModel`, so
    switching between them is exactly an env change (the agnosticism proof).
    """

    if config.provider is None:
        return DeterministicSupportModel()

    assert config.model is not None  # enforced by collect_llm_config
    return LangChainSupportModel(
        chat_model=create_chat_model(config),
        provider_name=config.provider,
        model_id=config.model,
        price_input_per_mtok=config.price_input_per_mtok,
        price_output_per_mtok=config.price_output_per_mtok,
    )
