# mesp-gateway

Streams a MESP device (or a recording, or the simulator) into the MESP API.

```bash
pip install -e ../../packages/protocol/python -e ../../replay -e ".[ble,serial,sim]"
export MESP_DEVICE_KEY='mesp_dk_…'          # from Console → Devices → Pair device
mesp-gateway --source ble    --ble-name MESP-Health --api ws://HOST:8000/api/v1/ingest/ws
mesp-gateway --source serial --port /dev/ttyUSB0 --baud 1000000
mesp-gateway --source replay --file session.mesprec --speed 4
mesp-gateway --source sim    --scenario fall           # SIMULATED DATA
mesp-gateway ... --record out.mesprec                   # keep the raw byte stream
```

Pipeline: source bytes → `Deframer` (resync, CRC) → `LinkStateMachine` → 50 ms batches → WebSocket uplink (backoff, bounded backlog, graceful `bye`). Protocol: `docs/protocol/ingest-protocol-v1.md`.
