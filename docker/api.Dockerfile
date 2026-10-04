# MESP API: FastAPI + ingest pipeline. Runs Alembic migrations, then uvicorn.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY packages/protocol/python /src/protocol
COPY replay /src/replay
COPY simulator /src/simulator
COPY services/gateway /src/gateway
COPY apps/api /src/api
RUN pip install /src/protocol /src/replay /src/simulator /src/gateway /src/api
COPY database /app/database
RUN useradd --system --uid 10001 mesp
USER mesp
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"
CMD ["sh", "-c", "alembic -c /app/database/alembic.ini upgrade head && exec uvicorn mesp_api.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
