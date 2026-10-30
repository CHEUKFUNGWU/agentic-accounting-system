# ADR-0002：後端以 Go 全面重寫

- 狀態：Accepted（owner 於 2026-10-24 決定，[SRC-0024](../01-inputs/2026-10-24-backend-golang-migration-decision.md)）。按 §3 階段推進，每階段閘門通過才進下一階段；P6 刪除 Python 後端屬破壞性操作，須 owner 屆時再次確認。本 ADR 不是版本承諾，不改變需求狀態。
- 日期：2026-10-24
- 來源：[SRC-0024](../01-inputs/2026-10-24-backend-golang-migration-decision.md)（owner 決策與原話）；調查證據為 2026-10-24 對工作樹的檢查（assistant inspection）；[SRC-0025](../01-inputs/2026-10-24-moejs-plugin-extension-request.md)（插件方向，僅影響 §8 約束）；[SRC-0026](../01-inputs/2026-10-24-open-findings-fold-into-golang-migration.md)（未處理審查發現的吸收，見 §3.1）
- 相關候選需求：REQ-0035（本遷移）、REQ-0031（開源準備）、REQ-0033（一鍵安裝首跑）；[ADR-0001](adr-0001-agent-first-mcp-architecture.md) D1、D5、D6

## 1. 背景

Observed，現況（2026-10-24 工作樹）：

| 事實 | 證據 |
| --- | --- |
| 後端 Python 約 10,100 行（23 檔），測試約 3,400 行（19 檔） | `backend/app/`、`backend/tests/` 統計 |
| 金額以標準庫 `decimal` 精確計算，345 處引用 | `backend/app/` grep |
| 雙資料庫：SQLite WAL（桌面）與 PostgreSQL（asyncpg）；同一套測試兩邊跑是 ADR-0001 的驗收要求 | [db.py](../backend/app/core/db.py)；ADR-0001 §6 |
| 桌面殼已是 Go（mygo），對本機 `127.0.0.1:8000` Python 服務做健康檢查；桌面用戶需自備 Python 3.11+ 與 uv | [main.go](../frontend/main.go) `CheckBackendHealth`；[monolith-backend.md](../docs/monolith-backend.md) |
| MCP 官方 Go SDK 為 Tier 1 支援，v1.8.0（2026-10-24 查證），支援 stateless streamable HTTP | [modelcontextprotocol/go-sdk](https://github.com/modelcontextprotocol/go-sdk) |
| 需求池全部需求仍為 candidate，無進行中的後端實作工作 | [requirement-pool.md](../04-requirement-pool/requirement-pool.md)（2026-10-24） |
| 本機 Go 工具鏈 1.27.1 可用，桌面殼 go.mod 已要求 go 1.27.1 | `go version`；[go.mod](../frontend/go.mod) |

Inferred：換 Go 的實質利益集中在發布與資源（單一靜態 binary、桌面免裝 Python、容器縮小、與桌面殼同語言），效能利益在此負載下趨近於零。助理 2026-10-24 建議延後重寫、以 PyInstaller 過渡（見 §5）；owner 決定趁初代版本全面更換（[SRC-0024](../01-inputs/2026-10-24-backend-golang-migration-decision.md)）。衝突如實記錄，不暗中調和。

## 2. 決策

### D1. 後端全面改用 Go，最終單一實現

- 遷移期間 Python 後端保留為參考實現，唯一職責是產生 golden fixtures 與對拍對照；P6 驗收後刪除，不長期維護雙棧。
- 遷移期間 `backend/`（Python）凍結新功能，僅接受安全性修補；新後端功能一律進 Go。

### D2. 對外契約凍結

以下逐項保持不變，既有資料必須被 Go 實現原樣讀取：

- REST 路徑與回應結構（`/api/v1/*`）。
- MCP 端點（`/mcp/<role>`）、工具名稱與輸入 schema（ADR-0001 D1 的版本化契約）。
- 資料庫 schema（[schema.sql](../database/schema.sql)）與遷移歷史。
- 審計軌跡與 hash chain 的正規化（canonical serialization）與雜湊格式。

### D3. 安全網：golden 對拍＋控制矩陣反例

- 每個移植模組先由 Python 參考實現產生 golden fixtures（輸入與輸出的 JSON），Go 測試重放並要求完全一致。
- [控制矩陣](accounting-control-matrix.md)反例（拆單繞額度、重放、越權、文件藏指令）在 Go 實現上重跑。
- [engineering-workflow §3](../00-rules/engineering-workflow.md#3-accounting-invariants) 的會計不變量在 Go 測試中逐條釘住；任何控制不得為了遷移或過閘門而弱化。
- 已知缺陷（未處理的審查發現，清單與落點見 §3.1，[SRC-0026](../01-inputs/2026-10-24-open-findings-fold-into-golang-migration.md)）不進入對拍基準：其情境自 golden 基準排除並登記為 expected divergence；每項發現在對應階段按 Bug fix playbook 於 Go 端重現、先寫失敗測試後修復，審查紀錄的核取框只以 Go 端測試與提交證據勾選。除阻斷 fixture 產生的情況外，不在凍結中的 Python 端重複修復。

### D4. 技術選型

| 用途 | Python 現況 | Go 決定 |
| --- | --- | --- |
| HTTP 服務 | FastAPI + uvicorn | `net/http`（stdlib）＋ chi 路由 |
| MCP | `mcp[cli]` 官方 SDK | `github.com/modelcontextprotocol/go-sdk`（官方 Tier 1） |
| 資料庫存取 | SQLAlchemy 2 async、asyncpg、aiosqlite | `database/sql`＋ pgx/v5（Postgres）、modernc.org/sqlite（純 Go，免 cgo，交叉編譯）；手寫 SQL，不用 ORM |
| 資料庫遷移 | db.py 手寫；D6 建議 Alembic | goose（SQL 遷移檔以 `go:embed` 打包；修訂見 §8） |
| 金額 | 標準庫 `decimal`（context 捨入） | `shopspring/decimal`；每個捨入點顯式指定捨入模式，不依賴全域預設 |
| 密碼雜湊 | argon2-cffi | `golang.org/x/crypto/argon2` |
| 資料驗證 | Pydantic v2 | struct tag＋手寫驗證函數 |
| 事件匯流排 | asyncio event bus | goroutine＋channel |
| 配置與日誌 | pydantic-settings、logging | 標準庫環境變數、`log/slog` |

### D5. 程式位置與命名

- 遷移期新代碼在 `backend-go/`（module `github.com/CHEUKFUNGUWU/agentic-accounting-system/backend-go`，go 1.27），目錄鏡像 `backend/app/`（`internal/core`、`internal/mcpserver`、`internal/mcproles`、`internal/api`、`internal/orchestrator`、`migrations/`），逐模組對照降低移植錯置。
- P6 切換時 `backend/`（Python）刪除，`backend-go/` 成為唯一後端（是否更名回 `backend/` 屆時由 owner 定），AGENTS.md 命令同步更新。

### D6. 階段閘門制

§3 各閘門為硬性條件。未通過不得進入下一階段；閘門擋住時修正實現，不是修改閘門。

## 3. 遷移階段與閘門

各階段內部按 Feature playbook 切 tracer-bullet tickets（一票貫穿所需層、單 session 可完成、先寫失敗測試）。

### P0. 工具鏈與骨架

- 範圍：`backend-go/` module、目錄骨架、gofmt/vet 規範、golden-fixture harness 雛形、雙資料庫測試骨架、`go build/test/vet` 命令入文件。
- 閘門：空骨架三命令全綠；harness 成功重放一個示範 fixture。

### P1. 純領域邏輯（無 I/O）

- 範圍：`localization`、`positions`、`sod_guard`、`vouchers` 驗證、`transactions`、`posting`、`ledger` 的純規則部分。
- 閘門：全模組 golden 一致；借貸平衡、負數拒絕、期間鎖定、自批禁例（一人公司模式除外）等不變量測試移植並通過。

### P2. 儲存層

- 範圍：`repository`、`db`（雙驅動初始化、WAL）、goose 遷移檔對齊 schema.sql 與現有手寫遷移、hash chain 逐位元組重現、Postgres RLS `SET LOCAL`。
- SQLite 紀律（沿用 Python 實現既有做法，[db.py](../backend/app/core/db.py) 模組註解）：金額一律以 TEXT 存放、以精確 decimal 解析，絕不經過浮點；WAL 模式配 busy_timeout；寫入經命令服務單一序列化；開檔時 `PRAGMA integrity_check`；備份與遷移工具須先 checkpoint 或一併複製 `-wal` 檔。
- 閘門：同一套測試在 SQLite 與 Postgres 全綠；以 Python 建立的既有帳本檔可讀取且 hash chain 驗證通過；從舊 schema 的升級遷移測試通過（對應 ADR-0001 D6 第 4 項）。

### P3. 報表

- 範圍：`reporting` 三表產生、鎖定與簽章 pack。
- 閘門：與 Python 輸出 golden 一致，簽章 pack 位元組相同。

### P4. MCP 層

- 範圍：`mcp_server` 工具實作、`mcp_roles` 崗位分流（go-sdk 每崗位一 server）、`aas1.` Bearer 憑證解析與 argon2 驗證、每次 `tools/call` 審計紀錄、結構化錯誤（ADR-0001 D1 契約）。
- 閘門：go-sdk 客戶端對兩個實現交叉呼叫，回應一致；人類-only 工具（核准、駁回、簽核、關帳）對 agent 憑證全部拒絕（O2-g 反例重跑）。

### P5. REST/SSE 與 orchestrator

- 範圍：`api_auth`、`api_monolith`、`api_documents`、`api_vouchers`、`event_bus`、SSE 推送。
- 閘門：前端 `build:web` 後對 Go 後端完成完整操作流程（登入、建立、覆核、過帳、報表）；`/api/v1` 契約 golden 一致。

### P6. 對拍驗收、切換與除役

- 範圍：全控制矩陣反例重跑；seeded 情境雙實現差分；AGENTS.md、docs、部署文件更新；刪除 Python `backend/`（破壞性，須 owner 確認）；mygo 殼健康檢查改指向 Go binary；桌面單 binary 構建驗證。
- 閘門：owner 核准切換與除役；控制矩陣反例零失敗；§3.1 的審查發現全部勾選或經 owner 同意延後。

每階段完成後執行 [engineering-workflow §4](../00-rules/engineering-workflow.md#4-review) 三軸審查（spec、standards、controls）。

### 3.1 未處理審查發現的落點（[SRC-0026](../01-inputs/2026-10-24-open-findings-fold-into-golang-migration.md)）

兩份審查紀錄共 30 項未處理發現（[業務邏輯審查](../07-reviews/2026-10-21-business-logic-audit.md) 23 項、[AIS 教科書審查](../07-reviews/2026-10-21-ais-textbook-gap-review.md) 7 項），隨各模組的移植在對應階段吸收，不回頭修 Python：

| 落點 | 吸收的發現 | 前置 owner 決策 |
| --- | --- | --- |
| P1 純領域邏輯 | BL-09～14、17、18、20、21、22、27、30、32～36 | BL-14 已定案（[SRC-0027](../01-inputs/2026-10-24-bl14-bl31-bl36-decisions.md)，owner 2026-10-30 確認）：management 自訂期間、financial 限 monthly／quarterly／semi-annually／annually；財務報表期間錨定 fiscal_periods 狀態，「annually」按主體財年。BL-36 已定向（SRC-0027）：格式隨法域規則包（REQ-0014 起），唯一性與斷號報告為系統級保證，初期用中立預設格式 |
| P2 儲存層 | BL-05（文件原子認領＋重複偵測）、23（備份含證據檔）、28（命令收據冪等） | — |
| P4 MCP 層 | BL-06（單一覆核授權政策）、07（崗位範圍投影）、08（證據歸屬與有效性檢查）、31（職責分離） | BL-31 已放寬定向（[SRC-0028](../01-inputs/2026-10-24-solo-mode-relaxation.md)）：以人類 principal 人數取代法律主體類型（solo mode）；機制待 owner 確認；法域規則包可依法加嚴 |
| P5 事件與 orchestrator | BL-24（投遞失敗重試狀態）、26（durable outbox，與 REQ-0008 對齊） | — |
| 前端（不在本遷移內） | BL-15、16、19 | BL-15/16 治本方向是前端改用後端報表 API（P5 後可行）；另行排程 |

- 每項發現的修復在移植該模組時按 Bug fix playbook 一併進行（Go 端重現、失敗測試、修復、勾選核取框）。
- BL-20 的治本（交易推導的真實稅務規則）屬 REQ-0014；遷移期間先做審查要求的 fail-closed：未支援管轄區明確拒絕，不回落 AU。

## 4. 風險與對策

| 風險 | 對策 |
| --- | --- |
| `decimal` 語義差異（Python context 捨入 vs shopspring 顯式模式），345 個觸點 | P1 起每個捨入點顯式指定模式；golden fixtures 覆蓋邊界值（半分位、負數、多幣別小數位） |
| hash chain 無法逐位元組重現，既有帳本驗證失敗 | D2 凍結格式；P2 閘門以真實 Python 產生的帳本檔驗證；失敗即停，不遷就重算 |
| SQLite driver 行為差異（modernc vs aiosqlite：WAL、併發、型別親和性） | 雙 DB 測試矩陣全程照跑（ADR-0001 §6 原要求不變） |
| go-sdk 與 python-sdk 行為差異（stateless streamable HTTP 細節、elicitation） | P4 交叉客戶端對拍；差異清單記入 07-reviews；OAuth 2.1（D2/REQ-0003）尚未實作，不受遷移影響 |
| 工期拉長或中斷，兩套並存腐化 | 階段閘門＋每階段可獨立停損；Python 端凍結新功能（D1）減少漂移 |
| agent 工作流換軌成本（命令、lint、審查證據格式） | P0 定稿命令與規範並寫入 backend-go README；AGENTS.md 於 P6 才切換，期間兩套並存 |

## 5. 考慮過的替代方案

| 方案 | 結果 |
| --- | --- |
| 延後重寫，先以 PyInstaller/Nuitka 打包 Python 後端過渡桌面分發 | 助理 2026-10-24 建議；owner 否決（[SRC-0024](../01-inputs/2026-10-24-backend-golang-migration-decision.md)）：初代版本重寫成本最低，避免日後更大重構 |
| 只把桌面 ledger core 移植 Go（嵌入 mygo 殼），伺服器端留 Python | 不採用：長期雙棧維護與雙份控制驗證，成本高於一次性遷移 |
| 維持 Python | 與 SRC-0024 目標不符：桌面零外部依賴、與桌面殼同語言、單 binary 發布 |

## 6. 後果

正面：

- 桌面版單一靜態 binary，消滅「先裝 Python＋uv」的採用門檻（直接支持 ADR-0001 D5 桌面拓撲與 REQ-0033 一鍵安裝）。
- 自託管鏡像顯著縮小；交叉編譯簡化多平台發布。
- 與 mygo 桌面殼同語言，P6 後可評估直接嵌入，消除本機 daemon 與健康檢查環節。

代價：

- 數週至兩月量級的遷移工作；遷移期 Python 後端凍結新功能。
- 345 個 decimal 觸點與雙 DB 矩陣全部重驗；測試移植會帶著原測試的假設，控制矩陣反例重跑是補償。
- agent 工作流（命令、lint、審查證據）全部換軌。

## 7. 驗證方式

- 各階段閘門（§3）逐項留存證據於 `07-reviews/`，連結自 REQ-0035 工作包。
- 最終驗收（P6）：控制矩陣反例零失敗；既有帳本檔讀取與 hash chain 驗證通過；真實 MCP 客戶端完成 OAuth 外的連線、提案、查詢、撤銷後拒絕；前端對 Go 後端完整流程；SQLite 與 Postgres 雙跑。
- §3.1 各項審查發現的回歸測試在 Go 端通過，證據連回兩份審查紀錄的核取框。

## 8. 與既有規劃的關係

- 修訂 ADR-0001 D6 第 4 項：版本化遷移工具由「建議 Alembic」改為 goose，隨本次語言決定更換；D6 其餘各項不變。
- AGENTS.md 的後端命令（pytest、ruff）於 P6 切換時改為 `go test`、`go vet`；在此之前兩套並存，Python 命令仍適用凍結中的 `backend/`。
- 需求池無 developing 中的後端需求（2026-10-24 Observed），遷移不排擠進行中工作；後端導向的候選需求（REQ-0002 起）未來實作時落點為 Go。
- [SRC-0025](../01-inputs/2026-10-24-moejs-plugin-extension-request.md)（用戶掛載自寫插件的未來方向）：本 ADR 不預設插件架構。唯一約束：插件不得形成第二條寫入路徑（與 ADR-0001 D1 同理），一切寫入經領域命令服務與既有控制。Owner 已確認運行時為 [Calcium-Ion/moejs](https://github.com/Calcium-Ion/moejs)：純 Go 的 JavaScript runtime，專為在 Go 程式內運行沙箱化 JS 插件而設計（Apache-2.0，與 AGPL 核心相容；alpha 階段，API 尚不穩定）。此方向進一步支持後端選 Go：JS 插件自然嵌入 Go 後端，Python 後端則需另行設計插件機制。前端掛載插件與後端語言無關。插件系統本身登記為候選需求 REQ-0036，未納入本遷移範圍。
