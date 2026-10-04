# ADR-008: Local accounts, JWT access tokens, hashed device keys

**Status:** accepted

**Decision.** Users: bcrypt hashes, three roles, HS256 JWTs (8 h; demo 4 h) in `sessionStorage`. Devices authenticate with random ingest keys stored as SHA-256 (no reversible copy). No external IdP, to keep the lab deployment self-contained.

**Consequences.** Simple and auditable. Missing: refresh tokens, revocation lists, SSO, MFA — documented in the threat model as known gaps.
