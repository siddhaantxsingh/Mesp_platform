# Firmware conformance harness

`vendor/nrf_link.c` and `vendor/nrf_link.h` are copied **verbatim** from the MESP_lab firmware
(`mesp_lab/Core/Src/nrf_link.c`, `Core/Inc/nrf_link.h`). `stub/` provides just enough of the
STM32 HAL for them to compile on a host. `gen_vectors.c` calls the real `Nrf_SendPPG`,
`Nrf_SendIMU`, `Nrf_SendECG`, `Nrf_SendText` and `Nrf_SendFrame`, captures the bytes that would
be DMA'd to USART1, and writes them to `packages/protocol/vectors/firmware_vectors.json`.

The platform's Python and TypeScript decoders are tested against those bytes, so the wire
format is taken from the firmware rather than from documentation or assumption.

```sh
./build.sh      # needs any C99 compiler
```

If the firmware's framing changes, re-vendor the two files, rebuild, and the protocol tests
will fail until the adapter is updated (or a new protocol version is registered).
