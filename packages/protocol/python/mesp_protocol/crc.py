"""CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, MSB-first, no reflection, no xorout.

Bit-for-bit equivalent of ``crc16_ccitt()`` in the firmware's ``nrf_link.c`` (table-driven
here for speed; the bitwise reference is kept for the tests).
"""

def _make_table() -> list[int]:
    table = []
    for i in range(256):
        crc = i << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
        table.append(crc)
    return table


_TABLE = _make_table()


def crc16_ccitt_false(data: bytes | bytearray | memoryview, crc: int = 0xFFFF) -> int:
    t = _TABLE
    for b in data:
        crc = ((crc << 8) & 0xFFFF) ^ t[((crc >> 8) ^ b) & 0xFF]
    return crc


def crc16_bitwise(data: bytes) -> int:
    """Literal transcription of the firmware loop (reference for tests)."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc
