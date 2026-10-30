# REQ-0035 工作指令：後端 Go 遷移（P0–P6）

- 發出：owner，[日期]
- 對象：執行工程師（人或 agent）
- 性質：本指令由 owner 發出後即為 REQ-0035 的開發授權——spec 與 codebase design 視為核准，執行者將[需求池](../../04-requirement-pool/requirement-pool.md)狀態更新為 `developing` 並在本指令發出時連結本文件。若 owner 修改本段，以修改後為準。

## 任務

把 Python 後端（`backend/`）完整遷移到 Go（`backend-go/`），按 [ADR-0002](../../03-planning/adr-0002-backend-golang-migration.md) 的 P0–P6 階段與閘門執行，遷移過程吸收 27 項未處理審查發現。最終 P6 驗收後刪除 Python 後端（刪除前必須再取得 owner 確認）。

## 必讀文件（按順序，開工前讀完）

1. [AGENTS.md](../../AGENTS.md) — 倉庫總規則、指令、硬邊界
2. [engineering-workflow.md](../../00-rules/engineering-workflow.md) — playbook、§3 會計不變量、§4 三軸審查、§5 證據要求
3. [ADR-0002](../../03-planning/adr-0002-backend-golang-migration.md) — 唯一計畫依據：D1–D6 決策、P0–P6 階段與閘門、§3.1 findings 落點
4. 本工作包 [README.md](README.md)（spec）與 [design.md](design.md)（codebase design，目錄與 interface 以此為準）
5. 兩份審查紀錄：[業務邏輯審查](../../07-reviews/2026-10-21-business-logic-audit.md)、[AIS 審查](../../07-reviews/2026-10-21-ais-textbook-gap-review.md) — findings 原文與核取框在這裡

## 執行規則（違反任何一條即停）

1. **按 playbook 工作**：階段內切 tracer-bullet tickets（貫穿所需層、單 session、先寫失敗測試）；每項 finding 修復按 Bug fix playbook：Go 端重現 → 失敗測試 → 修復 → 用 Go 測試證據勾選審查紀錄核取框。
2. **對外契約凍結**（ADR-0002 D2）：REST 路徑與回應結構、MCP 端點/工具/schema、資料庫 schema、hash chain 正規化格式，一概不得變更。
3. **Golden 對拍**（D3）：Python 參考實現產生 fixtures，Go 重放須逐位元組一致；已知缺陷僅能作為 expected divergence 排除，且一一對應 SRC-0026 finding ID、限定該 finding 的重現場景；不變量測試與控制矩陣反例永遠不得豁免。
4. **Python 後端凍結**：只接受安全修補；findings 不回修 Python。
5. **會計不變量與硬邊界**：AGENTS.md Hard boundaries 全部適用——任何控制不得為了過閘門而弱化；agent 永不核准；金額全程精確 decimal（JSON 過河用 string/`json.Number`，永不 float64）；已過帳分錄不可修改；hash chain 若無法逐位元組重現，停下回報，**絕不重算歷史**。
6. **每階段完成時**：執行三軸審查（spec/standards/controls，用互相獨立的 subagent），證據寫入 `07-reviews/` 並從本工作包連結；`go build`、`go test`、`go vet` 全綠；報告任何未驗證項。
7. **需求池紀律**：狀態只在 requirement pool 維護；正式狀態轉換需 owner 確認。

## 必須停下問 owner 的時機

- P6 刪除 Python `backend/` 之前（破壞性操作，ADR-0002 已規定）
- 任何會計控制語義的取捨、任何 finding 的修法會改變控制行為
- hash chain 重現失敗，或需要變更凍結契約的任何情況
- spec 沒有定義的新行為（產品決策，不自行發明）
- 需要對 `backend/`（Python）做安全修補以外的任何改動

## Git 紀律

- 每個階段開 feature branch（建議 `req-0035/p<N>-<主題>`）；commit message 引用 REQ-0035 與相關 BL/SRC ID，列出驗證內容
- push 權限：[owner 填寫——建議 A：可 push branch、merge 進 main 由 owner 核可；建議 B：沿用現行做法直接提交 main]
- 不變更 repository settings；不發布任何內容

## 交付物（每階段）

1. `backend-go/` 代碼與測試（P0 起，目錄結構按 [design.md](design.md)）
2. Golden fixtures 與 `divergences.yaml`（隨 P1 起累積）
3. `07-reviews/` 階段證據紀錄（閘門逐項對應 ADR-0002 §3）
4. 需求池 REQ-0035 進度註記
5. 階段報告：完成項、證據、未驗證項、下階段風險

## 環境

- Go 1.27+；PostgreSQL 16+（本地跑雙 DB 測試矩陣用）；uv（跑凍結的 Python 參考實現產 fixtures）；Node/npm（前端驗證）
- 既有命令見 AGENTS.md；`backend-go/` 的命令以 P0 建立的 README 為準

## 已定案事項（不要再決策一次）

BL-14 報表期間語義、一人公司模式（人數判定＋自動退場＋UI 名稱）、BL-36 編號（中立預設直到法域包）均由 owner 於 2026-10-24..30 定案，記錄在 spec 的 Implementation Decisions——照 spec 執行即可。
