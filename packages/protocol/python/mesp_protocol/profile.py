"""Device profiles: the facts about a firmware build that are NOT on the wire.

The link frames carry raw codes only — no sample rate, full-scale range or timestamp — so the
decoder needs to know how the firmware was configured. Each profile is pinned to the firmware
source it was read from. Select one per device; unknown values are ``None`` and the platform
renders them as "Not available".
"""
from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class DeviceProfile:
    id: str
    protocol_version: int
    firmware: str
    ppg_fifo_hz: float          # samples/s delivered by the MAX30102 FIFO (after averaging)
    ppg_adc_bits: int
    imu_hz: float
    accel_lsb_per_g: float
    gyro_lsb_per_dps: float
    ecg_hz: float
    ecg_adc_bits: int
    ecg_vref: float
    has_battery: bool           # MAX17048 driver present in firmware?
    has_skin_temp: bool         # MAX30205 driver present in firmware?
    has_display: bool           # SSD1306 driver present in firmware?
    source: str

    def to_dict(self) -> dict:
        return asdict(self)


# Defaults of MESP_lab main: PPG_PRESET_BALANCED (100 sps, 4x avg -> 25 Hz FIFO, 18-bit),
# IMU_PROFILE_LOWNOISE (+/-4 g -> 8192 LSB/g, +/-500 dps -> 65.5 LSB/dps, 1 kHz),
# ECG_SAMPLE_HZ 1000 on a 12-bit ADC at 3.3 V.
MESP_LAB_MAIN = DeviceProfile(
    id="mesp-lab-main-v1",
    protocol_version=1,
    firmware="MESP_lab@main (STM32G431KB, nrf_link v1)",
    ppg_fifo_hz=25.0,
    ppg_adc_bits=18,
    imu_hz=1000.0,
    accel_lsb_per_g=8192.0,
    gyro_lsb_per_dps=65.5,
    ecg_hz=1000.0,
    ecg_adc_bits=12,
    ecg_vref=3.3,
    has_battery=False,
    has_skin_temp=False,
    has_display=False,
    source="mesp_lab/Core/Inc/app_config.h, Core/Src/main.c (PPG_PRESET_BALANCED, IMU_PROFILE_LOWNOISE)",
)

# Same firmware with PPG_PRESET_SPO2_FAST and IMU_PROFILE_WIDEBAND.
MESP_LAB_FAST = DeviceProfile(
    **{**MESP_LAB_MAIN.to_dict(), "id": "mesp-lab-fast-v1", "ppg_fifo_hz": 1600.0, "ppg_adc_bits": 15,
       "accel_lsb_per_g": 4096.0, "gyro_lsb_per_dps": 16.4,
       "source": "mesp_lab main.c PPG_PRESET_SPO2_FAST + IMU_PROFILE_WIDEBAND (+/-8 g, +/-2000 dps)"}
)

PROFILES = {p.id: p for p in (MESP_LAB_MAIN, MESP_LAB_FAST)}
DEFAULT_PROFILE_ID = MESP_LAB_MAIN.id


def get_profile(profile_id: str | None) -> DeviceProfile:
    return PROFILES.get(profile_id or DEFAULT_PROFILE_ID, MESP_LAB_MAIN)
