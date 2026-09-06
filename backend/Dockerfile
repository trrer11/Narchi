# syntax=docker/dockerfile:1.7
# NARCHI V5 — Backend FastAPI multi-stage, non-root, Gunicorn/Uvicorn.

FROM python:3.11-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

ARG REQUIREMENTS_FILE=requirements.txt
COPY requirements*.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip wheel --wheel-dir /app/wheels -r ${REQUIREMENTS_FILE}
RUN cp ${REQUIREMENTS_FILE} /app/selected-requirements.txt

FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 libmagic1 poppler-utils curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin narchi

COPY --from=builder /app/wheels /wheels
COPY --from=builder /app/selected-requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

COPY . .
RUN mkdir -p storage/uploads storage/reports storage/norms \
    && chown -R narchi:narchi /app

USER narchi
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8000/health >/dev/null || exit 1

# Les accès sont journalisés en JSON par RequestDiagnosticsMiddleware/Nginx.
# Gunicorn conserve uniquement ses erreurs afin d'éviter un second log non filtré.
CMD ["gunicorn", "app.main:app", "--workers", "4", "--worker-class", "uvicorn_worker.UvicornWorker", "--bind", "0.0.0.0:8000", "--timeout", "120", "--graceful-timeout", "30", "--error-logfile", "-", "--capture-output"]
