"""MESP device simulator. Everything it produces is SIMULATED DATA.

It does not generate decoded values: it generates the *byte stream* the STM32 firmware would
put on USART1 (same framing, batching pattern, 8-bit sequence counter and 1 Hz stats lines),
so the gateway and backend run exactly the code path they run for real hardware.
"""
from .device import SimulatedDevice
from .scenarios import SCENARIOS, Scenario, get_scenario

__all__ = ["SCENARIOS", "Scenario", "get_scenario", "SimulatedDevice"]
