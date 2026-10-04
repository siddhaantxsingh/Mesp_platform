"""Byte-stream sources. Each yields ``SourceEvent``s: raw bytes or link up/down notices.

Every source feeds the same Deframer -> uplink path; only how bytes are obtained differs.
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

# Nordic UART Service (used by the firmware's ble_uart_bridge.ino via Bluefruit BLEUart)
NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
NUS_TX_CHAR = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"   # notify: peripheral -> central
DEFAULT_BLE_NAME = "MESP-Health"                         # Bluefruit.setName() in the bridge sketch


@dataclass
class SourceEvent:
    kind: str              # "data" | "up" | "down"
    data: bytes = b""
    rx_time: float = 0.0
    reason: str = ""


class Source(Protocol):
    name: str
    synthetic: bool
    realtime: bool          # rx_time is a true receive time (so ingest latency can be measured)

    def events(self) -> AsyncIterator[SourceEvent]: ...


class SimulatorSource:
    """Paces a SimulatedDevice in real time (scaled by ``speed``). SIMULATED DATA."""

    synthetic = True

    def __init__(self, scenario: str = "normal", seed: int = 1234, speed: float = 1.0, ble_chunk: int = 244):
        from mesp_simulator import SimulatedDevice, get_scenario
        self.device = SimulatedDevice(get_scenario(scenario), seed=seed, loop=True)
        self.name = f"simulator:{scenario}"
        self.speed, self.ble_chunk = speed, ble_chunk
        self.realtime = speed == 1.0       # latency is only meaningful at 1x

    SLOT = 0.02  # BLE connection-interval-ish delivery granularity

    async def events(self) -> AsyncIterator[SourceEvent]:
        from mesp_simulator.device import chunk_for_ble
        wall0, epoch0 = time.monotonic(), time.time()
        connected = True
        yield SourceEvent("up", reason="simulator started")
        while True:
            t_start = self.device.time
            em = self.device.generate(1.0)
            i, n_slots = 0, int(round(1.0 / self.SLOT))
            for k in range(n_slots):
                slot_end = t_start + (k + 1) * self.SLOT
                buf = bytearray()
                while i < len(em) and em[i].t <= slot_end + 1e-9:
                    buf += em[i].data
                    i += 1
                delay = slot_end / self.speed - (time.monotonic() - wall0)
                if delay > 0:
                    await asyncio.sleep(delay)
                up = self.device.connected_at(slot_end - 1e-6)
                if up != connected:
                    connected = up
                    yield SourceEvent("up" if up else "down",
                                      reason="simulated BLE reconnect" if up else "simulated BLE disconnect")
                if buf:
                    # timestamps follow device time (not wall time) so speed > 1 stays consistent
                    rx = epoch0 + slot_end
                    for piece in chunk_for_ble(bytes(buf), self.ble_chunk):
                        yield SourceEvent("data", piece, rx)


class ReplaySource:
    def __init__(self, path: str, speed: float = 1.0, loop: bool = True):
        from mesp_replay import ReplayEngine, read_recording
        self.rec = read_recording(path)
        self.engine = ReplayEngine(self.rec, speed=speed, loop=loop)
        self.synthetic = self.rec.synthetic
        self.realtime = False              # timestamps are recording time, not receive time
        self.name = f"replay:{path.rsplit('/', 1)[-1]}"

    async def events(self) -> AsyncIterator[SourceEvent]:
        yield SourceEvent("up", reason="replay started")
        epoch0 = time.time()
        loops, last_t = 0, -1.0
        async for t, data in self.engine:
            if t < last_t:              # looped: keep time monotonic
                loops += 1
                epoch0 += last_t + 0.5
            last_t = t
            # recording time, re-based to now: preserves sample timing at any replay speed
            yield SourceEvent("data", data, epoch0 + t)
        yield SourceEvent("down", reason="replay finished")


class SerialSource:
    """USB-UART adapter on the STM32 USART1 TX line (firmware bench mode), or any serial bridge."""

    synthetic = False
    realtime = True

    def __init__(self, port: str, baud: int = 1_000_000):
        self.port, self.baud = port, baud
        self.name = f"serial:{port}@{baud}"

    async def events(self) -> AsyncIterator[SourceEvent]:
        import serial  # pyserial
        loop = asyncio.get_running_loop()
        ser = await loop.run_in_executor(None, lambda: serial.Serial(self.port, self.baud, timeout=0.05))
        yield SourceEvent("up", reason=f"opened {self.port}")
        try:
            while True:
                data = await loop.run_in_executor(None, ser.read, 4096)
                if data:
                    yield SourceEvent("data", data, time.time())
        except serial.SerialException as e:
            yield SourceEvent("down", reason=f"serial error: {e}")
        finally:
            ser.close()


class BleSource:
    """BLE central: connects to the nRF52840 bridge and subscribes to NUS TX notifications."""

    synthetic = False
    realtime = True

    def __init__(self, address: str | None = None, name: str = DEFAULT_BLE_NAME, scan_timeout: float = 10.0):
        self.address, self.ble_name, self.scan_timeout = address, name, scan_timeout
        self.name = f"ble:{address or name}"

    async def events(self) -> AsyncIterator[SourceEvent]:
        from bleak import BleakClient, BleakScanner
        target = self.address
        if target is None:
            dev = await BleakScanner.find_device_by_filter(
                lambda d, adv: (d.name == self.ble_name) or (NUS_SERVICE in [u.lower() for u in adv.service_uuids]),
                timeout=self.scan_timeout)
            if dev is None:
                yield SourceEvent("down", reason=f"no device named {self.ble_name!r} advertising NUS")
                return
            target = dev.address
        q: asyncio.Queue[SourceEvent] = asyncio.Queue()
        disconnected = asyncio.Event()

        def on_notify(_char, data: bytearray) -> None:
            q.put_nowait(SourceEvent("data", bytes(data), time.time()))

        async with BleakClient(target, disconnected_callback=lambda _c: disconnected.set()) as client:
            await client.start_notify(NUS_TX_CHAR, on_notify)
            yield SourceEvent("up", reason=f"connected to {target}")
            while not disconnected.is_set():
                try:
                    yield await asyncio.wait_for(q.get(), timeout=0.5)
                except TimeoutError:
                    continue
        yield SourceEvent("down", reason="BLE disconnected")
