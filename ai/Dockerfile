# AI runtime sidecar image (Milestone 14, ADR-0020): the Python support graph
# served as a FastAPI service by uvicorn, dependencies managed by uv against
# the committed lockfile. Build context is the repository's ai/ directory:
#   docker compose -f infra/docker-compose.yml build ai-service
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app/ai

ENV UV_LINK_MODE=copy \
    PYTHONPATH=/app/ai \
    PYTHONUNBUFFERED=1

# Dependency layer first so source edits do not re-resolve the environment.
# The project itself is unpackaged (stdlib core, ADR-0016) and is imported via
# PYTHONPATH, so only locked dependencies are installed. The llm extra ships
# the LangChain provider stack (Milestone 15) so a real model activates by
# configuration alone — no image rebuild.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-install-project --extra service --extra llm

COPY runtime ./runtime
COPY service ./service
COPY evals ./evals

EXPOSE 8090

CMD ["uv", "run", "--frozen", "--no-sync", "--extra", "service", "--extra", "llm", "python", "-m", "uvicorn", "--factory", "service.app:create_app", "--host", "0.0.0.0", "--port", "8090"]
