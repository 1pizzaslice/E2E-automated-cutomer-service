"""Live, opt-in eval run against the env-configured model provider.

The offline suites (``evals.runner``, ``evals.injection_suite``) always run on
the deterministic model. This runner is the Milestone 15 live gate: it builds
the real provider from the same environment configuration the sidecar uses
(``SUPPORT_LLM_PROVIDER`` / ``SUPPORT_LLM_MODEL`` / key refs; see
``runtime/llm.py``) and drives the golden dataset plus the full
prompt-injection suite through it, applying the unchanged hard-fail gates
(zero unsafe auto-send, zero cross-tenant leaks, injection pass rate 1.0).

It is opt-in and costs real tokens — nothing in `pnpm test:py` invokes it.

Run (pilot default; requires ANTHROPIC_API_KEY):

    SUPPORT_LLM_PROVIDER=anthropic SUPPORT_LLM_MODEL=claude-opus-4-8 \
        PYTHONPATH=ai uv run --frozen --project ai --extra llm \
        python -m evals.live_runner

Provider-agnosticism proof (env change only — no code change):

    SUPPORT_LLM_PROVIDER=openai SUPPORT_LLM_MODEL=gpt-4o \
        ... python -m evals.live_runner
    SUPPORT_LLM_PROVIDER=scripted \
        ... python -m evals.live_runner   # offline, no keys, gates must pass

Exit status is non-zero when any hard-fail gate trips in either suite.
"""

from __future__ import annotations

import os
import sys

from runtime.llm import build_model_provider, load_llm_config

from .injection_suite import ALL_INJECTION_SUITE_CASES, run_injection_suite
from .golden_dataset import GOLDEN_CASES
from .runner import run_eval


def main() -> int:
    config = load_llm_config(os.environ)
    if not config.configured:
        print(
            "SUPPORT_LLM_PROVIDER is not set. The live runner exists to gate real\n"
            "providers; for the offline deterministic suites use `python -m evals.runner`\n"
            "and `python -m evals.injection_suite`.",
            file=sys.stderr,
        )
        return 2

    provider = build_model_provider(config)
    print(f"Live eval: provider={config.provider} model={config.model}")
    print(f"  golden cases: {len(GOLDEN_CASES)}; injection cases: {len(ALL_INJECTION_SUITE_CASES)}")
    print()

    golden = run_eval(model_factory=lambda: provider)
    print("Golden " + golden.format())
    print()

    injection = run_injection_suite(model_factory=lambda: provider)
    print("Injection " + injection.format())

    return 0 if (golden.passed and injection.passed) else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
