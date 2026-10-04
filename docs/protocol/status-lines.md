# Proposed STATUS lines (not emitted by the current firmware)

The board carries a MAX17048 fuel gauge and a MAX30205 temperature sensor, but the firmware has no drivers for them yet. To add them **without a protocol version change**, the platform already parses these lines in `STATUS` (0x03) or `TEXT` (0x04) frames:

| Line | Meaning | Platform field |
|---|---|---|
| `batt soc=<0-100> mv=<millivolts>` | MAX17048 state of charge and cell voltage | `battery_soc`, events `battery_low` (<15 %), `battery_critical` (<5 %) |
| `temp skin_mc=<milli-°C>` | MAX30205 skin temperature | `skin_temp_c` |

Until the firmware sends them, the console shows **Not available** with the reason. Only the `low_battery` simulator scenario emits `batt` lines, and it is labelled as using the proposed extension.

Suggested firmware change (1 Hz, next to the existing `stats` line in `main.c`):

```c
snprintf(line, sizeof line, "batt soc=%u mv=%u", soc_percent, vcell_mv);
(void)Nrf_SendFrame(NRF_FRAME_TYPE_STATUS, (const uint8_t *)line, (uint16_t)strlen(line));
```
