# ADR-002: The gateway forwards raw, CRC-checked frames; the API decodes

**Status:** accepted

**Context.** Two options: decode at the edge and send JSON samples, or deframe at the edge and send the original frames.

**Decision.** The gateway deframes (it has to: BLE splits frames arbitrarily) and forwards each complete frame **unchanged** in a compact binary batch (ingest v1). The API re-verifies the CRC and does all decoding.

**Consequences.**
- One decoder in production (the API's), versioned with device profiles. Gateways stay thin and rarely need updates.
- The server never trusts edge parsing; a buggy or malicious gateway cannot inject decoded values.
- The byte-exact simulator and recordings exercise the server decoder directly.
- Cost: the API spends CPU on decoding (measured: ~6 400 frames/s per process on 2 vCPU, see load results).
