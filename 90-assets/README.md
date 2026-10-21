# Shared assets

Store reusable presentations, prototype screenshots, and other shared assets. Reference assets from Markdown instead of duplicating files. Record external assets in the source register.

`ui-references/` holds third-party product screenshots supplied as design references. It is excluded by `.gitignore` and kept locally only, because the project does not hold release rights for them ([ADR-0001 D6](../03-planning/adr-0001-agent-first-mcp-architecture.md#d6-開源發布的前提)). Source records that link to these images will not resolve in a fresh clone.
