"""Versioned prompt files with stable IDs (harness section 8).

Each real-model prompt lives in this package as ``<prompt_id>.md`` where the
``prompt_id`` already carries the version (``support_classifier.v1``). The file
starts with a small frontmatter block declaring its ``prompt_id`` and
``version``; :func:`load_prompt` parses and validates it, so a renamed or
mislabeled file fails loudly instead of silently serving the wrong prompt.

The deterministic offline model is rule-based and does not render these files;
the LangChain-backed provider (``runtime.llm``) renders ``body`` as the system
instructions and appends the machine-readable input block. Changing a prompt's
behavior materially requires a new version (a new ``.v2`` file), an eval run,
and a harness-doc update — never edit a shipped version in place.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_PROMPT_DIR = Path(__file__).resolve().parent

# The prompt ids this package currently ships. Kept explicit so a typo in a
# caller (or a missing file) fails at load time with a clear message.
KNOWN_PROMPT_IDS: tuple[str, ...] = (
    "support_classifier.v1",
    "support_response_composer.v1",
)

_FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.S)


class PromptNotFoundError(KeyError):
    """Raised when a prompt id has no backing file in this package."""


@dataclass(frozen=True)
class PromptTemplate:
    """One loaded prompt version."""

    prompt_id: str
    version: str
    body: str


def load_prompt(prompt_id: str) -> PromptTemplate:
    """Load and validate the prompt file for ``prompt_id``."""

    path = _PROMPT_DIR / f"{prompt_id}.md"
    if prompt_id not in KNOWN_PROMPT_IDS or not path.is_file():
        raise PromptNotFoundError(
            f"unknown prompt_id {prompt_id!r}; known prompts: {KNOWN_PROMPT_IDS}"
        )

    raw = path.read_text(encoding="utf-8")
    match = _FRONTMATTER_RE.match(raw)
    if not match:
        raise ValueError(f"prompt file {path.name} is missing its frontmatter block")

    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()

    declared_id = fields.get("prompt_id")
    version = fields.get("version")
    if declared_id != prompt_id:
        raise ValueError(
            f"prompt file {path.name} declares prompt_id {declared_id!r}, expected {prompt_id!r}"
        )
    if not version:
        raise ValueError(f"prompt file {path.name} declares no version")

    return PromptTemplate(
        prompt_id=prompt_id,
        version=version,
        body=raw[match.end() :].strip(),
    )
