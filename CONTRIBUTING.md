# Contributing

1. `make install`, then `make test` (Python lint + tests, web type-check + tests). Run `make e2e` with the stack running for UI changes.
2. **Protocol changes start in the firmware.** Re-vendor `nrf_link.[ch]` into `firmware-harness/vendor/`, run `make vectors`, and update the decoders until the conformance tests pass. Never edit `firmware_vectors.json` by hand.
3. Never present synthetic data as real. Anything produced by the simulator must keep `synthetic=True` end to end.
4. Never write an unmeasured number into docs or UI. Write "Not yet measured" instead.
5. Keep the clinical wording rule: events describe signal patterns ("irregular RR-interval pattern", "fall suspected"); nothing claims a diagnosis.
6. Decisions that change architecture get an ADR in `docs/decisions/`.
7. Commits: imperative subject, explain *why* in the body.
