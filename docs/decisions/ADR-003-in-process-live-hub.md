# ADR-003: In-process live hub, single API instance

**Status:** accepted (revisit when more than ~15 concurrent devices are needed)

**Context.** Live samples must reach browsers with low latency. Options: an in-process pub/sub, Redis pub/sub, or a message broker (NATS/Kafka).

**Decision.** In-process `LiveHub` with per-client bounded queues (drop-oldest). The ingest session for a device lives on the API instance its gateway is connected to.

**Consequences.** No extra infrastructure; sub-50 ms median ingest-to-publish latency in tests. Horizontal scaling is not possible as-is: two API replicas would split subscribers from publishers. Measured capacity is ~16 real-time devices per process on 2 vCPU. Scale-out path: publish hub messages to Redis Streams or NATS keyed by device, and move DSP into worker processes. The interfaces (`ctx.publish`, `hub.subscribe`) were kept narrow so this is a drop-in change.
