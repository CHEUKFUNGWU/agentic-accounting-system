# AIS textbook gap review request

- Source ID: SRC-0018
- Received: 2026-10-21
- Provider: repository owner via this conversation
- Scope: compare the system with a standard accounting information systems textbook, identify missing capabilities and business-logic defects not already in the [business logic audit](../07-reviews/2026-10-21-business-logic-audit.md)

## Original messages

> 我把這本書放進來docs/reference裡。你看一遍，看看我們還缺什麼，作為一個accounting system。業務邏輯還有沒有什麼問題。不過我們之前也有audit過一次，記錄在findings裡了，同事正在修復。

After the assistant reported its findings:

> Yes. Write the 7 new findings (BL-30 to BL-36) and the capability gaps into a new 07-reviews file, keeping it separate from my colleague's audit record. Also add docs/reference/ to .gitignore so the book never gets committed.

## Reference material

- Marshall B. Romney and Paul John Steinbart, *Accounting Information Systems*, Pearson. The owner supplied an OCR Markdown conversion of the book. Edition and year are not stated in this record; to confirm.
- Location: `docs/reference/`, kept locally only. The book is copyrighted. It is excluded by `.gitignore` and must not be committed or distributed, especially because the owner plans an open-source release ([SRC-0017](2026-10-21-agent-first-mcp-architecture-request.md)).
- The review cites table and control numbers and paraphrases. It does not reproduce the book's text.

## Interpretation

- Observed: the owner asked for a gap analysis and a business-logic review that excludes findings BL-01 to BL-29, which a colleague is remediating.
- Observed: the owner asked for the results in a separate review file, with findings numbered BL-30 to BL-36.
- Not covered: remediation of the new findings, requirement registration for the capability gaps, and statutory interpretation of any jurisdiction's rules.

## References

- [AIS textbook gap review](../07-reviews/2026-10-21-ais-textbook-gap-review.md) (SRC-0019).
