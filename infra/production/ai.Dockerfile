# Production image for the Python AI runtime sidecar (Milestone 18).
#
# Build context is the repository's ai/ directory (Compose sets this):
#   docker build -f infra/production/ai.Dockerfile -t support-ai ./ai
#
# Hardened variant of ai/Dockerfile: identical uv-locked dependency install
# (stdlib core imported via PYTHONPATH, ADR-0016; the llm extra ships the
# LangChain provider stack so a real model activates by configuration alone),
# but runs uvicorn as a dedicated non-root user with a pinned worker count.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app/ai

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONPATH=/app/ai \
    PYTHONUNBUFFERED=1

# Dependency layer first so source edits do not re-resolve the environment.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-install-project --extra service --extra llm

COPY runtime ./runtime
COPY service ./service
COPY evals ./evals

# Drop privileges: create an unprivileged user and hand it the app tree
# (including the .venv that uv created) so the runtime never executes as root.
RUN useradd --system --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["/app/ai/.venv/bin/python", "-c", "import urllib.request,sys; sys.exit(0) if urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=3).status==200 else sys.exit(1)"]

# SUPPORT_UVICORN_WORKERS lets the pilot scale the sidecar without a rebuild.
CMD ["sh", "-c", "uv run --frozen --no-sync --extra service --extra llm python -m uvicorn --factory service.app:create_app --host 0.0.0.0 --port 8090 --workers ${SUPPORT_UVICORN_WORKERS:-2}"]
