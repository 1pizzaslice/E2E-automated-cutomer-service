"""AI runtime service bridge (Milestone 14).

A FastAPI sidecar that exposes the Python support graph as
``POST /internal/ai/run`` (``RuntimeRequest`` JSON in → ``RuntimeResult`` JSON
out) plus ``GET /health``, with bearer-token auth, structured JSON logs, and
HTTP port adapters (:class:`service.adapters.HttpToolExecutor`,
:class:`service.adapters.HttpRetrieval`) that call the TypeScript backend.

Everything except :mod:`service.app` (the only fastapi import site) runs on the
standard library, matching the runtime's ADR-0016 posture.
"""
