from dataclasses import dataclass
from typing import Literal


AutomationMode = Literal["auto_send", "human_approve", "human_only"]
RiskLevel = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class RuntimeDecision:
    """Minimal placeholder for the future LangGraph runtime output."""

    automation_mode: AutomationMode
    risk_level: RiskLevel
    reason_codes: tuple[str, ...]


def build_initial_decision(*, allow_auto_send: bool = False) -> RuntimeDecision:
    """Return the safe v1 default until the LangGraph graph is implemented."""

    if allow_auto_send:
        return RuntimeDecision(
            automation_mode="human_approve",
            risk_level="medium",
            reason_codes=("auto_send_not_enabled_in_scaffold",),
        )

    return RuntimeDecision(
        automation_mode="human_approve",
        risk_level="low",
        reason_codes=("v1_default_human_approval",),
    )

