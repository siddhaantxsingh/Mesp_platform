# MESP gateway. BLE inside a container needs the host's BlueZ D-Bus socket (see docs/deployment).
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
COPY packages/protocol/python /src/protocol
COPY replay /src/replay
COPY simulator /src/simulator
COPY services/gateway /src/gateway
RUN pip install /src/protocol /src/replay /src/simulator "/src/gateway[serial,ble]"
RUN useradd --system --uid 10002 gateway
USER gateway
ENTRYPOINT ["mesp-gateway"]
CMD ["--source", "sim"]
