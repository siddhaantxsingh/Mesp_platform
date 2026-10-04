# Security policy

This is an engineering/research prototype. Do not use it to store or transmit real patient data without your own security review.

**Reporting:** please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue. Include steps to reproduce and the affected component (gateway, API, web).

**Secrets:** never commit `.env`, ingest keys, JWT secrets or database passwords. If a key is exposed, rotate it immediately (Devices → Rotate key) and change `MESP_JWT_SECRET` (this signs out every user).

Threat model and known gaps: [docs/security/threat-model.md](docs/security/threat-model.md).
