# Source register

| Source ID | Date | Material | Type | Provider | Repository location | Applicable scope | Processing state |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SRC-0001 | 2026-10-17 | English product workspace setup request | User instruction, English summary | Repository owner via chat | [Workspace setup request](2026-10-17-workspace-setup.md) | Documentation structure and collaboration rules | Applied to initial workspace setup |
| SRC-0002 | 2026-10-17 | Monolith Ledger UI archive and direct-adoption instruction | User-supplied React source archive | Repository owner via chat | [UI adoption source record](2026-10-17-monolith-ui.md) | Default frontend interface | Imported; automated checks passed |
| SRC-0003 | 2026-10-17 | Adapt the backend to the adopted frontend | User instruction | Repository owner via chat | [Backend integration request](2026-10-17-monolith-backend.md) | Persistent Monolith accounting workflows and frontend API connection | Implemented; automated and browser validation passed |
| SRC-0004 | 2026-10-17 | Begin implementing the existing authentication design | User instruction | Repository owner via chat | [Authentication implementation request](2026-10-17-auth-implementation.md) | Shared human/agent authentication, authorization, and login | Initial implementation prepared and validated; MFA and remaining phases deferred |

## Registration rules

- Do not silently rewrite original material.
- Register a new version as a new entry, retain the old version, and link the relationship.
- Formal requirements must cite source IDs such as `SRC-0001`.
- Use the date the material was received or created and explain any uncertain provenance.
- Processing state describes input handling only, not a requirement's lifecycle status.
