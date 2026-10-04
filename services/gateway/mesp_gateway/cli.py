"""mesp-gateway: stream a MESP device (or the simulator / a recording) into the MESP API."""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import signal

from .runner import Gateway, WebSocketUplink


def build_source(a: argparse.Namespace):
    from . import sources
    if a.source == "sim":
        return sources.SimulatorSource(a.scenario, seed=a.seed, speed=a.speed)
    if a.source == "replay":
        return sources.ReplaySource(a.file, speed=a.speed, loop=not a.once)
    if a.source == "serial":
        return sources.SerialSource(a.port, a.baud)
    if a.source == "ble":
        return sources.BleSource(a.address, a.ble_name)
    raise SystemExit(f"unknown source {a.source}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="mesp-gateway", description=__doc__)
    ap.add_argument("--source", choices=["sim", "replay", "serial", "ble"], default=os.getenv("MESP_SOURCE", "sim"))
    ap.add_argument("--api", default=os.getenv("MESP_API_INGEST", "ws://localhost:8000/api/v1/ingest/ws"))
    ap.add_argument("--device-key", default=os.getenv("MESP_DEVICE_KEY", ""),
                    help="device ingest key (env MESP_DEVICE_KEY); never commit it")
    ap.add_argument("--scenario", default=os.getenv("MESP_SCENARIO", "normal"))
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--file", help="recording for --source replay")
    ap.add_argument("--once", action="store_true", help="replay once instead of looping")
    ap.add_argument("--port", default="/dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=1_000_000)
    ap.add_argument("--address", help="BLE address (default: scan for --ble-name)")
    ap.add_argument("--ble-name", default="MESP-Health")
    ap.add_argument("--record", help="also write the raw byte stream to this .mesprec file")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(asctime)s %(name)s %(message)s")
    if not a.device_key:
        raise SystemExit("a device key is required (--device-key or MESP_DEVICE_KEY)")
    source = build_source(a)
    recorder = None
    if a.record:
        from mesp_replay import RecordingWriter
        recorder = RecordingWriter(a.record, source=source.name, synthetic=source.synthetic)

    async def run() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop.set)
            except NotImplementedError:
                pass
        uplink = WebSocketUplink(a.api, a.device_key)
        gw = Gateway(source, uplink, recorder=recorder)
        try:
            await gw.run(stop)
        finally:
            await uplink.close()

    try:
        asyncio.run(run())
    finally:
        if recorder:
            recorder.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
