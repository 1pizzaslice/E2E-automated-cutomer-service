"""Service configuration loaded from the environment (fail-fast).

Secrets follow the platform convention in ``packages/integrations/src/secrets.ts``:
configuration carries secret *references* — the NAME of an environment variable
matching ``SECRET_REF_PATTERN`` — never secret values. ``load_service_config``
resolves the references, validates everything, and raises one ``ValueError``
listing every problem so a misconfigured deployment fails at boot, not on the
first request.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Mapping, Optional

from runtime.llm import LlmConfig, collect_llm_config

# Mirror of SECRET_REF_PATTERN in packages/integrations/src/secrets.ts: a secret
# reference must be a plausible environment variable name.
SECRET_REF_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")

SERVICE_MODES = ("local", "service")

_DEFAULT_SERVICE_TOKEN_REF = "SUPPORT_AI_SERVICE_TOKEN"
_DEFAULT_API_TOKEN_REF = "SUPPORT_INTERNAL_API_TOKEN"
_DEFAULT_HTTP_TIMEOUT_MS = 5000


@dataclass(frozen=True)
class ServiceConfig:
    """Validated runtime-service configuration."""

    token: str
    mode: str  # "local" | "service"
    api_base_url: Optional[str]
    api_token: Optional[str]
    http_timeout_s: float
    environment: str
    # Model provider selection (Milestone 15, runtime/llm.py): unset keeps the
    # deterministic offline model; a real provider activates only by explicit
    # SUPPORT_LLM_PROVIDER / SUPPORT_LLM_MODEL configuration.
    llm: LlmConfig = field(
        default_factory=lambda: LlmConfig(provider=None, model=None, api_key=None)
    )


def _resolve_secret(
    env: Mapping[str, str],
    ref_var: str,
    default_ref: str,
    errors: list[str],
    *,
    required: bool,
) -> Optional[str]:
    """Resolve a secret reference (the name of an env var) to its value."""

    ref = env.get(ref_var, default_ref)
    if not SECRET_REF_PATTERN.match(ref):
        errors.append(
            f"{ref_var} must match {SECRET_REF_PATTERN.pattern} "
            f"(it names an environment variable), got {ref!r}"
        )
        return None
    value = env.get(ref)
    if value:
        return value
    if required:
        errors.append(f"secret {ref} (referenced by {ref_var}) is required but not set")
    return None


def load_service_config(env: Mapping[str, str] = os.environ) -> ServiceConfig:
    """Load and validate the service configuration.

    Collects ALL problems and raises a single ``ValueError`` listing them.
    """

    errors: list[str] = []

    mode = env.get("SUPPORT_AI_SERVICE_MODE", "local")
    if mode not in SERVICE_MODES:
        errors.append(f"SUPPORT_AI_SERVICE_MODE must be one of {SERVICE_MODES}, got {mode!r}")
    service_mode = mode == "service"

    token = _resolve_secret(
        env, "SUPPORT_AI_SERVICE_TOKEN_REF", _DEFAULT_SERVICE_TOKEN_REF, errors, required=True
    )

    api_base_url = env.get("SUPPORT_API_BASE_URL")
    if api_base_url is not None:
        api_base_url = api_base_url.rstrip("/")
        if not api_base_url:
            errors.append("SUPPORT_API_BASE_URL must not be empty")
            api_base_url = None
    if service_mode and api_base_url is None:
        errors.append("SUPPORT_API_BASE_URL is required when SUPPORT_AI_SERVICE_MODE=service")

    api_token = _resolve_secret(
        env, "SUPPORT_API_TOKEN_REF", _DEFAULT_API_TOKEN_REF, errors, required=service_mode
    )

    raw_timeout = env.get("SUPPORT_AI_SERVICE_HTTP_TIMEOUT_MS", str(_DEFAULT_HTTP_TIMEOUT_MS))
    http_timeout_s = _DEFAULT_HTTP_TIMEOUT_MS / 1000.0
    try:
        timeout_ms = int(raw_timeout)
        if timeout_ms <= 0:
            raise ValueError
        http_timeout_s = timeout_ms / 1000.0
    except ValueError:
        errors.append(
            f"SUPPORT_AI_SERVICE_HTTP_TIMEOUT_MS must be a positive integer, got {raw_timeout!r}"
        )

    environment = env.get("SUPPORT_ENVIRONMENT", "local")

    llm = collect_llm_config(env, errors)

    if errors:
        raise ValueError(
            "invalid AI runtime service configuration:\n"
            + "\n".join(f"- {error}" for error in errors)
        )

    assert token is not None  # errors would have been raised otherwise
    return ServiceConfig(
        token=token,
        mode=mode,
        api_base_url=api_base_url,
        api_token=api_token,
        http_timeout_s=http_timeout_s,
        environment=environment,
        llm=llm,
    )
