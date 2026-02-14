FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md /app/
COPY src /app/src
COPY config /app/config

RUN python -m pip install --upgrade pip && \
    python -m pip install -e .

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -m homunculus --check --config /app/config/homunculus.example.json || exit 1

CMD ["python", "-m", "homunculus", "--config", "/app/config/homunculus.example.json"]
