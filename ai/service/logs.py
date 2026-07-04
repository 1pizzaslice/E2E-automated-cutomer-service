"""Structured JSON-lines logging for the AI runtime service.

Every log line is a single JSON object on stdout carrying ``service``,
``environment``, ``timestamp``, ``level``, ``message`` plus the caller's fields
(correlation_id, trace_id, tenant_id, ticket_id, ai_run_id, status, error_code,
duration_ms, ...). Only identifiers and outcomes are logged — never message
bodies, drafts, or secrets.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Union

SERVICE_NAME = "ai-runtime"
LOGGER_NAME = "ai_runtime.service"

_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}

ServiceLogger = Union[logging.Logger, logging.LoggerAdapter]


def create_service_logger(environment: str) -> logging.LoggerAdapter:
    """Return a logger that emits one JSON object per line to stdout."""

    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    return logging.LoggerAdapter(logger, {"environment": environment})


def log_event(logger: ServiceLogger, level: str, message: str, **fields: Any) -> None:
    """Emit one structured JSON log line. ``None`` fields are omitted."""

    if isinstance(logger, logging.LoggerAdapter):
        environment = str((logger.extra or {}).get("environment", "unknown"))
        target = logger.logger
    else:
        environment = "unknown"
        target = logger

    payload: dict[str, Any] = {
        "service": SERVICE_NAME,
        "environment": environment,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "message": message,
    }
    for key, value in fields.items():
        if value is not None:
            payload[key] = value
    target.log(_LEVELS.get(level, logging.INFO), json.dumps(payload, default=str))
