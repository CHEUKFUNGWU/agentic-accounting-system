# ADR-0001：Agent-first MCP 架構

- 狀態：Accepted（D1～D6 方向，owner 於 2026-10-21 核准，見 [SRC-0017](../01-inputs/2026-10-21-agent-first-mcp-architecture-request.md#owner-decision-2026-10-21-remaining-recommendations)）。O1 於 2026-10-24 決定（[SRC-0023](../01-inputs/2026-10-24-license-decision.md)）；O3、O4、O5 仍待決定。核准不構成版本承諾，也不改變需求狀態
- 日期：2026-10-21
- 來源：[SRC-0017](../01-inputs/2026-10-21-agent-first-mcp-architecture-request.md)、[SRC-0005](../01-inputs/2026-10-18-roadmap-request.md)、[SRC-0006](../01-inputs/2026-10-18-roadmap-code-baseline.md)、[SRC-0007](../01-inputs/2026-10-18-roadmap-primary-sources.md)、[SRC-0023](../01-inputs/2026-10-24-license-decision.md)
- 相關候選需求：REQ-0002、REQ-0003、REQ-0006、REQ-0007、REQ-0008、REQ-0016、REQ-0023（狀態只維護於[需求池](../04-requirement-pool/requirement-pool.md)）

## 1. 背景

Owner 確認兩個方向（[SRC-0017](../01-inputs/2026-10-21-agent-first-mcp-architecture-request.md)）：系統以開源方式發布，別人可直接部署使用；各種 AI Agent 經 MCP 接入，覆蓋大部分人手工作。這延續 [SRC-0005](../01-inputs/2026-10-18-roadmap-request.md) 已確認的「外部 AI Agent 經 MCP 接入做帳，部分低風險科目自動過帳，其餘由人覆核」。

Observed，現況（2026-10-21 工作樹）：

| 現況 | 證據 |
| --- | --- |
| 每個會計崗位一個 MCP server，未註冊的工具對該崗位不可見 | [mcp_roles.py](../backend/app/mcp_roles.py) 檔頭說明及 `build_role_server` |
| Agent 身分取自連線上的 Bearer 憑證，不取自參數；每次 `tools/call` 寫審計紀錄 | `RequirePosition`，[mcp_roles.py](../backend/app/mcp_roles.py) |
| 憑證為靜態 `aas1.` API key，有到期與撤銷，人類 principal 不可用 | `resolve_api_key`，[auth.py](../backend/app/core/auth.py) |
| 崗位固定綁定單一公司 | `entity_code_for` 回傳 `DEFAULT_ENTITY`，[mcp_roles.py](../backend/app/mcp_roles.py) |
| 自動核准門檻掛在 principal 上，含 `min_confidence_threshold` | `principal_from` 一帶，[auth.py](../backend/app/core/auth.py) |
| 資料庫層支援 SQLite WAL 與 PostgreSQL（asyncpg），遷移為手寫特例邏輯 | `DatabaseManager`，[db.py](../backend/app/core/db.py) |
| 根目錄沒有 LICENSE 檔 | 2026-10-21 檢查 |

Inferred：開源後，每一個必要的執行期依賴都由採用者承擔部署成本；而接入的模型由使用者自選，系統無法控制其能力。因此正確性與安全只能由伺服器端的確定性控制保證。

## 2. 決策

### D1. Agent 只經領域層 MCP 接入

- Agent 只能使用崗位分流的領域工具（如 `create_voucher`、`submit_voucher`）。
- 不向 Agent 提供資料庫層 MCP 或 SQL 工具，包括 Supabase MCP server、通用 Postgres MCP server，以及任何 `execute_sql` 類工具。這些只屬開發與運維用途。
- 不開放 PostgREST、supabase-js 或任何前端直連的寫入路徑。所有寫入經共同帳務命令服務（REQ-0002），由 [sod_guard.py](../backend/app/core/sod_guard.py) 等確定性控制把關。
- 沿用現有「每崗位一個 server」設計。工具名稱與 schema 是版本化契約；錯誤回傳結構化原因碼、欄位與下一步，符合[控制矩陣](accounting-control-matrix.md#提案與批准狀態)的回應要求。

### D2. MCP 連線採 OAuth 2.1

- MCP server 作為 OAuth 2.1 resource server，依實作時選定的 [MCP Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) 規範版本提供 protected resource metadata、驗證 token 的 audience 與 resource，並要求 PKCE。
- 使用者在 MCP 客戶端按「連接」→ 登入 → 選擇公司與崗位 → 取得短期 token。Token 不轉交給下游服務。
- 授權伺服器預設內建，開源採用者不需額外部署；可選擇改接外部 OIDC 提供者（Keycloak、Authentik、Supabase Auth 等），由後端把外部身分對應到既有 principal 與崗位。
- 現有靜態 `aas1.` 憑證保留給桌面版與受控服務帳號，並明確標示其支援範圍。
- 互通驗收用的兩個 MCP 客戶端沿用 [Roadmap](product-roadmap.md) v0.6 的要求。

### D3. 多租戶身分：tenant × entity × position

- 資料階層為 tenant（事務所或客戶組織）→ entity（法人／個體戶）→ book（帳套）。
- 每個憑證或 OAuth token 綁定一個 tenant、一組獲授權的 entity 與一個崗位。命令服務對每次讀寫檢查此範圍，取代現有 `entity_code_for` 的單公司假設（銜接 REQ-0003、REQ-0023）。
- PostgreSQL 上以 RLS 作為第二道防線：每個交易以 `SET LOCAL app.tenant_id` 設定範圍，policy 依此過濾。應用程式以非資料表擁有者的角色連線，並對相關資料表啟用 `FORCE ROW LEVEL SECURITY`，避免擁有者或 superuser 繞過。
- Policy 不依賴 Supabase 的 `auth.uid()` 或 `auth.jwt()`，以便在任何 Postgres 上運作。
- SQLite 桌面版為單一 tenant，以應用層檢查為準。
- 預設採共用資料庫加 `tenant_id`；有資料在地化或隔離要求的採用者，可改為每 tenant 一個資料庫（見 O4）。

### D4. 分級自主權政策

自主權由伺服器端的版本化政策決定，不由 Agent 自行聲稱，也不以模型 confidence 作為放行條件（與[控制矩陣](accounting-control-matrix.md#低風險自動過帳政策)一致）。

| 等級 | 處理 | 例子 |
| --- | --- | --- |
| 拒絕 | 硬性規則失敗，直接拒絕並記錄原因碼 | 借貸不平、期間已鎖、越權、控制科目手工分錄 |
| 政策自動過帳 | 符合已核准政策版本的提案，由服務端重驗後過帳 | 控制矩陣列出的首批模板 |
| 人工覆核 | 不符政策或資料不足的提案，進人工佇列 | 其餘所有提案（SRC-0005 基線） |
| 僅限人類 | Agent 工具不提供此能力 | 報表簽核、關帳／重開、政策變更、對外付款、報稅 |

- 無有效政策時一律人工覆核。
- Agent 不能修改政策、提升自身權限，或把 `approved=true` 當作授權。
- 政策先以 shadow mode 對照人工結果，再按公司與模板逐項啟用。每個政策都有停用開關（kill switch，REQ-0007）。
- 現有掛在 principal 上的 `max_auto_approve_func_amount` 與 `min_confidence_threshold` 改由政策版本承載；confidence 只作為顯示資訊。
- 不符自動政策的提案一律由人類批准（O2-g，owner 已於 2026-10-21 決定）。Checker agent 只做預審與建議：核對證據、金額、科目、期間與稅務，標記異常，並提出附理由的建議結論，讓人工佇列可按「Agent 同意且無異常」與「有疑點」分流。預審意見不改變提案狀態，也不構成批准。
- 自主權的擴大路徑是「人機一致率達 shadow mode 標準 → 由 owner 批准為自動政策」，而不是讓 Agent 取得批准權。
- 批量核准只適用於 Agent 同意且無異常的項目；需隨機抽樣完整覆核，並監測核准耗時與一致率，避免流於蓋章。

#### 一人公司模式（owner 已於 2026-10-21 決定）

一人公司的老闆是唯一的利害關係人，內部職責分離沒有可保護的對象。依 owner 決定（[SRC-0017](../01-inputs/2026-10-21-agent-first-mcp-architecture-request.md#owner-decision-2026-10-21-one-person-company-profile)），建立公司時選擇一人公司類型即套用以下設定，以方便使用與推廣為優先：

| 項目 | 一人公司模式 | 其他公司（中小企業、事務所） |
| --- | --- | --- |
| 老闆自己建立的分錄 | 老闆可自行核准，系統標記為「自行核准」 | 建立者不得核准自己的分錄 |
| 外部會計師覆核 | 不需要 | 依崗位設定 |
| Agent 批准 | 不允許（O2-g） | 不允許（O2-g） |
| 自動政策啟用或變更 | 老闆一人批准 | 老闆加外部會計師兩人批准（O2-h） |
| Shadow mode | 較寬鬆，見 O2-f | 兩次完整月結、100% 一致（O2-f） |

- 確定性控制照常運作，不因模式放寬：借貸平衡、期間鎖定、重複偵測、hash chain 及審計紀錄。
- 提供「年末審計包」匯出：自行核准分錄清單、Agent 操作紀錄、hash chain 驗證結果及證據索引，供審計師或報稅會計師使用。
- 理由是一人公司本身不需要內部職責分離，而不是依賴年末審計。年末審計在香港普遍適用，但澳洲 Pty Ltd、美國單一成員 LLC 及新加坡小公司一般沒有審計。
- 已放寬並定案（owner 於 2026-10-24 決定放寬、2026-10-30 確認機制，[SRC-0028](../01-inputs/2026-10-24-solo-mode-relaxation.md)）：適用判定從「各市場法律主體類型」改為**人類 principal 人數**——任何 entity 只有一位活躍人類 principal 時即可啟用本模式，理由是採用門檻優先。第二位人類 principal 出現即自動回到 maker-checker；歷史自行核准保留標記。UI 名稱維持「一人公司模式」。法域規則包仍可對特定主體類型依法加嚴（大陸一人公司審計要求維持待確認），但不得再放寬。
- 尚未實作：現有崗位設計中，一人公司的覆核落在外部會計師崗位，創辦人崗位不能複核（[positions.py](../backend/app/core/positions.py)）。

### D5. 儲存拓撲：標準 Postgres 為核心，Supabase 可選

| 模式 | 對象 | 必要元件 |
| --- | --- | --- |
| 桌面 | 個體戶、一人公司、試用 | SQLite，零外部依賴 |
| 自託管 | 小企業、事務所 | 應用程式容器 + PostgreSQL 16+；檔案存本機磁碟或 S3 相容儲存 |
| 雲端 | 不想自行運維者 | 任何託管 PostgreSQL（Supabase、Neon、RDS 等）+ 物件儲存 |

- 核心程式不得使用 Supabase 專屬能力：PostgREST、`auth.uid()` 型 RLS、supabase-js 寫入、Supabase Realtime、Edge Functions。
- 可抽換的介面：
  - 檔案儲存：本機檔案系統／S3 相容儲存／Supabase Storage。
  - 驗證：內建／外部 OIDC。
  - 事件推送：outbox 加 `LISTEN/NOTIFY`，經 SSE 推送（銜接 REQ-0008）。
  - 向量檢索：可關閉；Postgres 上可選用 pgvector。
- Supabase 定位為官方支援的雲端部署目標之一，可提供部署範本與文件，但不是必要依賴。完整自託管 Supabase 的運維成本由選擇它的採用者自行承擔。

### D6. 開源發布的前提

以下事項完成前，不公開發布：

1. Owner 選定授權條款並加入 LICENSE（O1）。
2. 確認 [SRC-0002](../01-inputs/2026-10-17-monolith-ui.md) 提供的 Monolith UI 原始碼，以及 `90-assets/` 參考素材具有公開發布的權利。
3. 掃描前後端第三方依賴的授權相容性。
4. 以版本化遷移（建議 Alembic）取代 [db.py](../backend/app/core/db.py) 的手寫遷移，並在 CI 測試從舊版本升級。
5. 首次啟動自動產生密鑰與管理員帳號，不內建任何預設密鑰或 token。
6. 提供完整匯出（帳本、證據、審計軌跡）。
7. 稅務與會計規則以版本化規則包發布，並附「不構成稅務或審計意見」的聲明。
8. 貢獻政策：任何人可提 issue，pull request 不對所有人開放（owner 於 2026-10-21 決定，[SRC-0017](../01-inputs/2026-10-21-agent-first-mcp-architecture-request.md#owner-decision-2026-10-21-contribution-policy)）。在 CONTRIBUTING 說明，並以 repository 設定或自動化執行；可提交 PR 的範圍待確認。

## 3. Owner 待決事項

### O1. 授權條款

| 選項 | 效果 | 適合 |
| --- | --- | --- |
| AGPL-3.0 | 他人修改後以網路服務提供，也須公開修改後的原始碼；可阻止閉源 SaaS 直接包裝 | 希望保護社群成果，並保留日後商業雲端或雙授權空間 |
| Apache-2.0 | 寬鬆，含專利授權；企業與商業產品採用門檻最低 | 優先追求採用量與生態整合 |
| MIT | 最寬鬆，無專利條款 | 小型函式庫較常見；對會計平台較少採用 |

相關的附帶決定：

- 是否要求貢獻者簽 CLA 或 DCO。若日後要雙授權或更改授權，需事先保留權利。PR 不對外開放（D6 第 8 項）後，此項影響大幅降低。
- 是否註冊名稱或商標。
- 已發布版本的授權不能追溯收回，因此須在首次公開前決定。

#### 決定（owner 於 2026-10-24 決定，[SRC-0023](../01-inputs/2026-10-24-license-decision.md)）

- 核心系統（後端、MCP 伺服器、前端）採 AGPL-3.0-or-later（版本選擇由 owner 於 2026-10-24 決定）。
- 供第三方整合的套件（MCP 工具定義、客戶端 SDK、ChatGPT 與 Claude 外掛或 skill 套件）採 Apache-2.0。這些套件目前尚未獨立存在。
- 註冊產品名稱或商標。名稱尚未確定：owner 認為可能是 nomaledger，「Monolith」可能是 AI 工具取的名。
- 若日後開放外部 PR，須要求 CLA，以保留雙授權與更改授權的權利。
- 已確認：依賴套件授權均與 AGPL-3.0 相容（2026-10-24 依已安裝套件檢查）。
- 已確認：Monolith UI 由 owner 於 Google AI Studio 生成，未以第三方素材作設計參考（owner 於 2026-10-24 確認）。
- 已加入 LICENSE（gnu.org 官方 AGPL-3.0 原文，2026-10-24）與 README 授權說明。
- 待確認：產品名稱與各市場商標檢索、版權人名稱，以及名稱確定後將「Monolith」更名。owner 於 2026-10-24 延後處理，將交由同事跟進。

### O2. 自主權門檻

控制矩陣已規定門檻由 owner 填入並批准，未填即人工。除 O2-g 及一人公司部分外，以下各項由 owner 於 2026-10-21 採納助理建議（[SRC-0017](../01-inputs/2026-10-21-agent-first-mcp-architecture-request.md#owner-decision-2026-10-21-remaining-recommendations)）。

| 編號 | 事項 | 決定 |
| --- | --- | --- |
| O2-a | 出貨預設姿態 | 已決定：自動過帳預設關閉，由 tenant 管理員逐模板啟用 |
| O2-b | 單筆上限：每模板、每 entity，以本位幣計 | 已決定：依模板設定，不設單一全域金額。固定訂閱費須與已核准合約價格完全一致；時間表認列須與已核准時間表金額完全一致；任何差額轉人工。銀行手續費是唯一需要金額上限的模板，試點起點約 CNY 200 或 AUD 50 一筆，待會計負責人確認 |
| O2-c | 累計上限：每政策每日／每月，防拆單繞額度 | 已決定：每個政策每月累計不超過前三個月平均的 1.5 倍；超過即暫停該政策並通知人，而不是只拒絕該筆 |
| O2-d | 單一憑證速率：每小時／每日提案數 | 已決定：每個憑證每小時 60 筆、每日 500 筆提案；超過即暫停該憑證並通知 |
| O2-e | 首次交易或新對象是否一律人工 | 已決定：是，首次出現的交易對象一律人工（與控制矩陣一致） |
| O2-f | Shadow mode 啟用條件：期間、樣本數、與人工結果一致率 | 一人公司：已決定採較寬鬆標準（2026-10-21），建議每模板連續 10 筆科目、金額、期間一致，確切數字待確認。其他公司：已決定（2026-10-21）至少跑完兩次完整月結（與 REQ-0017 試點對齊），每模板至少 30 筆，科目、金額、期間與人工結果 100% 一致；任何一筆不一致即重新計算。此門檻與控制矩陣「初始至少 100 筆」的規劃起點未調和，待會計負責人確認 |
| O2-g | 是否允許 Checker agent 批准一般分錄 | 已決定（2026-10-21）：不允許；Agent 只能預審與建議 |
| O2-h | 誰可批准政策變更：tenant 管理員、外部會計或兩人共同 | 一人公司：已決定由老闆一人批准（2026-10-21）。其他公司：已決定（2026-10-21）由老闆加外部會計師兩人批准；新政策須先通過 shadow mode 才生效；批准者不得為該政策的受益提案人 |

O2-g 決定紀錄：對話中曾建議設「Agent 覆核」一級，由 Checker agent 批准一般分錄。這與 [SRC-0005](../01-inputs/2026-10-18-roadmap-request.md)「其餘由人覆核」以及控制矩陣「非人類 Agent 不能呼叫人工核准端點」衝突。Owner 於 2026-10-21 選擇維持基線（[SRC-0017](../01-inputs/2026-10-21-agent-first-mcp-architecture-request.md#owner-decision-2026-10-21)）：不符自動政策者一律由人類批准，Checker agent 只預審與建議。[控制矩陣](accounting-control-matrix.md#提案與批准狀態)已同步。O2-f 與 O2-h 已就一人公司決定（見 D4「一人公司模式」）；其餘 O2 項目亦已於同日依建議決定。各金額與筆數為試點起點，待會計負責人確認後調整。

Observed（2026-10-21）：Monolith 路徑已移除非人類崗位的 `journal.review`，但崗位分流 MCP 的 `review_voucher` 及 `authorize_review` 當時未檢查核准者是否為人類，Agent 憑證可經 MCP 核准憑證。修正與回歸測試見本次工作樹變更。

### O3. 其他待確認

- O3-a：內建授權伺服器的範圍，例如是否支援 MFA 與 passkey，以及與 REQ-0003 的關係。
- O3-b：兩個首批互通驗收的 MCP 客戶端（Roadmap v0.6 已列為待確認）。
- O3-c：中國大陸等有資料在地化要求市場的建議部署方式與文件。

### O4. Tenant 隔離模型

預設採共用資料庫加 RLS（D3）。是否另外正式支援每 tenant 一個資料庫，取決於在地化與隔離需求，待 owner 與目標採用者確認。

### O5. 外掛市集發布與第三方客戶端權限

來源：[SRC-0021](../01-inputs/2026-10-21-marketplace-distribution-request.md)。候選需求 REQ-0034。

待 owner 決定：是否提供託管版。ChatGPT plugin 目錄與 Claude Connectors Directory 的上架項目都指向單一公開 HTTPS MCP server，因此上架等於由我們託管客戶的帳本。自架採用者各有不同網址，改以自訂 connector 連接，不需上架。

權限設計建議（未決定），建立在 D2、D3 之上：

- 身分取自 OAuth 授權，不綁定 ChatGPT 或 Claude 的 thread／session ID。伺服器無法驗證 thread ID；MCP 的 `Mcp-Session-Id` 只代表傳輸連線；綁定對話也擋不住同一對話中的提示注入。宿主提供的對話參照只記入審計紀錄，不作授權依據。
- 經 ChatGPT 或 Claude 的每次呼叫都視為 Agent 呼叫，即使指令是 owner 本人在對話中輸入。宿主自己的確認視窗無法在伺服器端驗證。此點延伸 O2-g。
- 第三方客戶端只能取得查詢與提案範圍。核准、駁回、過帳、結帳鎖期、政策與憑證管理永不授權給它們。
- 核准在本系統介面登入後進行，可經 MCP URL 模式 elicitation 導向；一人公司的自我核准同樣在此進行並加註。
- 每個宿主各自取得授權，綁定 tenant、entity 與崗位，可分別撤銷；O2-d 速率限制按每個授權計算。
- 工具輸出會進入宿主模型的上下文：輸出最小化、遮罩銀行帳號，並在隱私政策中說明。

待確認：ChatGPT 與 Claude 是否支援 URL 模式 elicitation；Anthropic 官方文件中的目錄上架要求。

## 4. 考慮過的替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 以 Supabase 為核心 BaaS，前端經 PostgREST／RLS 直接讀寫 | RLS 只能控制可見範圍，無法保證借貸平衡、職責分離、期間鎖定與 hash chain；會形成第二條寫入路徑 |
| 必須自託管完整 Supabase | 十多個容器的運維成本由所有採用者承擔，第一階段實際只用到 Postgres 與 Storage |
| 單一 MCP server 加參數式權限檢查 | 官方 SDK 的 `list_tools` 不分角色過濾；可見即可被注入攻擊誘導呼叫。現有程式已因此改為崗位分流 |
| 以模型 confidence 決定自動過帳 | 控制矩陣明確禁止；不同使用者的模型不可比較，也無法稽核 |
| 繼續只用靜態 API key | 一般 MCP 客戶端以 OAuth 為主流程；手動貼 token 不利採用，且難以做短期、可撤銷、綁 audience 的授權 |

## 5. 後果

正面：

- 任意 MCP 客戶端都能以標準流程接入，正確性不依賴所接模型的品質。
- 自託管只需應用程式加 Postgres，降低開源採用門檻。
- 不綁定單一雲端供應商，有在地化要求的市場可自選基礎設施。

代價：

- 需自行實作或整合 OAuth 授權伺服器，並維持多種驗證與儲存實作的測試矩陣。
- SQLite 與 Postgres 的行為差異（併發、RLS、數值型別）需持續在 CI 兩邊驗證。
- 放棄 Supabase Realtime、Auth 等現成能力帶來的開發速度，改用標準 Postgres 機制自建。

## 6. 驗證方式（核准後適用）

- 兩個指定 MCP 客戶端完成 OAuth 連接、提案、查詢結果及撤銷後拒絕。
- 跨 tenant、跨 entity 的讀寫全部被拒絕，包括故意繞過應用層、直接以應用程式資料庫角色查詢時被 RLS 擋下。
- 拆單繞額度、重放、越權、惡意單據指令等反例沿用[控制矩陣](accounting-control-matrix.md#工程與-agent-反例)。
- 同一套測試在 SQLite 與 PostgreSQL 各跑一次；另跑一次 Supabase 託管 Postgres 的部署煙霧測試（Supabase 只作為可選目標驗證）。
- 從前一個發布版本升級的遷移測試。

## 7. 與既有規劃的關係

本 ADR 不新增或變更需求狀態，也不修改 [Roadmap](product-roadmap.md) 的版本範圍。Owner 已核准 D1～D6 方向，因此：

- D1、D2、D3 的內容併入 REQ-0003、REQ-0006、REQ-0023 的工作包定義。
- D4 的內容併入 REQ-0007。
- D5 的事件機制併入 REQ-0008。
- D6 可能需要新增「開源發布準備」候選需求，須 owner 確認後才登記到需求池。
- O5 已登記為候選需求 REQ-0034（owner 於 2026-10-21 要求，[SRC-0021](../01-inputs/2026-10-21-marketplace-distribution-request.md)）。
