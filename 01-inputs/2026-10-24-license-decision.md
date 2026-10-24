# License decision and product name

- Source ID: SRC-0023
- Received: 2026-10-24
- Provider: repository owner via this conversation
- Scope: ADR-0001 O1 (license), integration-package licensing, trademark, contributor terms, release rights for the Monolith UI, and the product name

## Original messages

Context, following [SRC-0022](2026-10-24-personal-agent-positioning.md):

> 畢竟開源，先在X平台面向中國大陸的開發者打響名聲先。有很多OPC的主理人也在X

The assistant noted that ADR-0001 O1 (license) was still open and must be decided before first publication. The owner asked:

> APGL 3.0你覺得如何？

The assistant read this as AGPL-3.0, recommended it, and suggested three additions: Apache-2.0 for integration packages, registering the name or trademark, and a CLA if outside pull requests are ever accepted. The owner answered:

> OK，採納你的三點建議。monolith好像不知道是AI自己取的還是怎樣，我們的名字叫nomaledger好像是

## Owner decision

- Observed: the owner adopted AGPL-3.0 for ADR-0001 O1 and the three additions:
  1. Core system (backend, MCP servers, frontend) under AGPL-3.0. Integration packages meant for third parties (MCP tool definitions, client SDKs, ChatGPT and Claude plugin or skill packages) under Apache-2.0. None of these packages exists separately yet.
  2. Register the product name or trademark.
  3. Require a CLA if outside pull requests are ever accepted. They are closed under ADR-0001 D6 item 8.
- Observed: the owner believes the product name is "nomaledger" and that "Monolith" may have been named by an AI tool. The owner wrote "好像是", so the name is not settled.

### Owner confirmation (2026-10-24)

> 是，Monolith UI 是我自己在 Google AI Studio 生成的，沒有用第三方截圖當設計參考。

- Observed: the owner generated the Monolith UI in Google AI Studio and gave it no third-party screenshots as design references.

## Assistant findings

### Monolith UI provenance

- Observed: `~/Downloads/monolith-ledger-—-agentic-accounting-system.zip` has the SHA-256 recorded in [SRC-0002](2026-10-17-monolith-ui.md) (`baebb248…993ac`).
- Observed: the archive contains `.aistudio/` and a `metadata.json` named "Monolith Ledger — Agentic Accounting System". Its `package.json` is named `react-example` and depends on `@google/genai`. These match a Google AI Studio export.
- Observed: one image inside `.aistudio/artifacts/` was inspected; it is a screenshot of the generated app itself, with a sample entity "Monolith Holdings Inc. (US-DE)".
- Observed (primary source, read as a search-result excerpt on 2026-10-24): the [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) say Google won't claim ownership of generated content and may generate the same or similar content for others.
- Inferred: "Monolith Ledger" is the name given in AI Studio, not a name the owner chose. If the owner generated the UI in AI Studio, Google's terms do not prevent releasing it under AGPL-3.0. Copyright in AI-generated code may be weak, which affects enforcement, not the right to release.

### Product name

- Observed: "nomaledger" appears nowhere in the repository.
- Observed: a web search on 2026-10-24 for "NomaLedger" returned only an unrelated Pinterest profile. This is not a trademark search.

### Dependency licenses

Checked on 2026-10-24 from installed packages, not from a lockfile audit.

- Observed: frontend packages are MIT, ISC, Apache-2.0, BSD, 0BSD and CC-BY-4.0, plus `@fontsource-variable/inter` (OFL-1.1) and `lightningcss` (MPL-2.0, build tool).
- Observed: backend packages are MIT, BSD, Apache-2.0 and PSF, plus `certifi` (MPL-2.0).
- Inferred: all are compatible with AGPL-3.0. OFL-1.1 requires the font's license to travel with the font.

### LICENSE file

- Observed: on 2026-10-24, with the owner's approval, `https://www.gnu.org/licenses/agpl-3.0.txt` was downloaded unchanged into `LICENSE` (34,523 bytes, SHA-256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`). A License section was added to `README.md`.

### Version choice (2026-10-24)

> 用 AGPL-3.0-or-later。

- Observed: the owner chose `AGPL-3.0-or-later`. It was added as the license field in `backend/pyproject.toml` and `frontend/package.json`.

## To confirm

The owner deferred the items below on 2026-10-24 and will assign them to a colleague:

> 你記錄進文檔裡就好，我晚點會找同事改

- The product name, and trademark searches in the target markets (Mainland China, Hong Kong, Australia, North America; Singapore if added).
- Copyright holder name for the README and source-header notices. The AGPL text in `LICENSE` needs none.

## Not covered

- Legal advice. The assistant is not a lawyer.
- Renaming "Monolith" in code, UI and documents once the product name is settled. Deferred with the items above.
- The X go-to-market plan, which was discussed but not recorded as a decision.
