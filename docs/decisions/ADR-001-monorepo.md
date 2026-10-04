# ADR-001: One monorepo for protocol, gateway, API and web

**Status:** accepted

**Context.** The wire protocol is shared by the simulator, gateway, API and (in TypeScript) the browser. When those lived in separate places, the protocol drifted between the firmware and its decoders.

**Decision.** A single repository with independently installable packages: `packages/protocol` (Python and TypeScript), `simulator`, `replay`, `services/gateway`, `apps/api`, `apps/web`, plus `firmware-harness` that pins the protocol to the firmware source.

**Consequences.** A protocol change is one commit and one CI run that exercises every consumer. The cost is a mixed toolchain (pip and npm) in one CI file, and each package needs explicit dependency declarations (no implicit imports across folders).
