# Copyright 2026 Gwang-Jin Kim
# SPDX-License-Identifier: AGPL-3.0-only

FROM python:3.12-slim-bookworm AS builder
ENV CMAKE_ARGS="-DGGML_NATIVE=OFF -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod -DLLAMA_CURL=OFF" CMAKE_BUILD_PARALLEL_LEVEL=2
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN python -m venv /opt/venv
COPY requirements.lock ./
RUN /opt/venv/bin/pip install --no-cache-dir --require-hashes -r requirements.lock
COPY pyproject.toml ./
COPY app ./app
RUN /opt/venv/bin/pip install --no-cache-dir --no-deps .

FROM python:3.12-slim-bookworm
ENV PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/data/huggingface DATA_DIR=/data
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app \
    && mkdir /data && chown app:app /data
COPY --from=builder /opt/venv /opt/venv
USER app
WORKDIR /home/app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "180"]
