"""Minimal stdlib JSON-over-HTTP client used by the port adapters.

``post_json`` is the injectable seam: adapters take a ``post`` callable with
this exact signature, so tests substitute a fake without any network or extra
dependencies. HTTP error *statuses* are returned (the caller decides what a
non-200 means for its port contract); transport-level failures (DNS, refused
connection, timeout) raise :class:`HttpTransportError`.
"""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True)
class HttpJsonResponse:
    status: int
    body: Any


class HttpTransportError(Exception):
    """The request never produced an HTTP response (DNS/connect/timeout)."""


def _parse_body(raw: bytes) -> Any:
    """Best-effort body parse: JSON when possible, decoded text otherwise."""

    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw.decode("utf-8", errors="replace")


def post_json(
    url: str,
    *,
    headers: Mapping[str, str],
    body: Any,
    timeout_s: float,
) -> HttpJsonResponse:
    """POST ``body`` as JSON and return the (status, parsed-body) response."""

    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=dict(headers), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            return HttpJsonResponse(status=response.status, body=_parse_body(response.read()))
    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read()
        except OSError:
            raw = b""
        return HttpJsonResponse(status=exc.code, body=_parse_body(raw))
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as exc:
        raise HttpTransportError(str(exc)) from exc
