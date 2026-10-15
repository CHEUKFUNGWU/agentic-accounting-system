import React from "react";
import { Badge, Button } from "./ui/shadcn";

interface AppHeaderProps {
  entityCode: string;
  onEntityChange: (code: string) => void;
  period: string;
  onPeriodChange: (period: string) => void;
  packStatus: string;
  isLiveBackend: boolean;
  dbPathFormatted: string;
  pendingCount: number;
  onOpenSplitModal: () => void;
  onOpenAjeModal: () => void;
  onOpenReviewModal: () => void;
  onBackupDb: () => void;
  onLockPack: () => void;
}

const ENTITY_OPTIONS = [
  { code: "AU-OPC-01", label: "🇦🇺 AU-OPC-01: Spark AI Studio Pty Ltd (Single-Director OPC)", standard: "AASB Tier 2" },
  { code: "CN-OPC-01", label: "🇨🇳 CN-OPC-01: 上海智算一人有限公司 (PRC One-Person Ltd)", standard: "PRC CAS" },
  { code: "HK-SME-01", label: "🇭🇰 HK-SME-01: Pacific Nexus Tech Limited (HK SME)", standard: "SME-FRS" },
  { code: "SG-OPC-01", label: "🇸🇬 SG-OPC-01: Merlion Autonomous Labs Pte. Ltd. (SG Exempt OPC)", standard: "SFRS Small" },
  { code: "US-SOLE-01", label: "🇺🇸 US-SOLE-01: Griffin Analytics LLC (Single-Member LLC / Schedule C)", standard: "US GAAP" },
  { code: "EU-OPC-01", label: "🇪🇺 EU-OPC-01: rheinAI Cloud UG / GmbH (EU Single-Member OPC)", standard: "IFRS" },
];

export const AppHeader: React.FC<AppHeaderProps> = ({
  entityCode,
  onEntityChange,
  period,
  onPeriodChange,
  packStatus,
  isLiveBackend,
  dbPathFormatted,
  pendingCount,
  onOpenSplitModal,
  onOpenAjeModal,
  onOpenReviewModal,
  onBackupDb,
  onLockPack,
}) => {
  return (
    <header
      style={{
        borderBottom: "1px solid var(--border)",
        backgroundColor: "var(--background)",
        padding: "0.875rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        position: "sticky",
        top: 0,
        zIndex: 30,
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
      }}
    >
      {/* Top Bar: Title, DB Status, Live Indicator */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              width: "2rem",
              height: "2rem",
              backgroundColor: "var(--primary)",
              color: "var(--primary-foreground)",
              borderRadius: "0.375rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "1.1rem",
            }}
          >
            A
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontWeight: 600, fontSize: "1.05rem", letterSpacing: "-0.01em" }}>
                Agentic Accounting System
              </span>
              <Badge variant="outline" style={{ fontSize: "0.75rem" }}>
                MyGo Desktop Client
              </Badge>
            </div>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              SME, OPC & Sole Proprietor 3-Statement Working Papers • Stateless MCP
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          {/* Storage Status */}
          <Badge variant="secondary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }} title={dbPathFormatted}>
            💾 {dbPathFormatted ? "SQLite WAL" : "Local Ledger"}
          </Badge>

          {/* Live vs Offline Status Badge */}
          {isLiveBackend ? (
            <Badge variant="success" style={{ fontSize: "0.75rem" }}>
              ● 本地 API 在線 (Live)
            </Badge>
          ) : (
            <Badge variant="warning" style={{ fontSize: "0.75rem" }}>
              ⚠ 本地內存降級模式 (Offline Fallback)
            </Badge>
          )}

          {/* CPA Status Badge */}
          {packStatus === "CPA_SIGNED_LOCKED" ? (
            <Badge variant="default" style={{ backgroundColor: "#16a34a", color: "#fff", fontSize: "0.75rem" }}>
              🔒 会計師已簽核封存 (CPA Locked)
            </Badge>
          ) : (
            <Badge variant="outline" style={{ fontSize: "0.75rem", borderColor: "#f59e0b", color: "#d97706" }}>
              ✍ 待 CPA 審核 (Ready for Sign-off)
            </Badge>
          )}
        </div>
      </div>

      {/* Controls Bar: Entity Select, Period Select, Action Buttons */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {/* Entity Selector */}
          <select
            value={entityCode}
            onChange={(e) => onEntityChange(e.target.value)}
            className="sh-select"
            style={{ width: "auto", minWidth: "300px", fontWeight: 500, fontSize: "0.875rem" }}
          >
            {ENTITY_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Period Selector */}
          <select
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
            className="sh-select"
            style={{ width: "auto", fontWeight: 500, fontSize: "0.875rem" }}
          >
            <option value="2026-10">2026-10 (當前月結期)</option>
            <option value="2026-09">2026-09 (前期存檔)</option>
            <option value="2026-Q3">2026-Q3 (季度結算)</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={onOpenSplitModal} style={{ fontSize: "0.825rem" }}>
            ✂ 公私混用費用拆分
          </Button>

          <Button variant="secondary" onClick={onOpenAjeModal} style={{ fontSize: "0.825rem" }}>
            ⚖ 提列月結調整 (AJE)
          </Button>

          <Button
            variant="outline"
            onClick={onOpenReviewModal}
            style={{ fontSize: "0.825rem", position: "relative" }}
          >
            🛡 SoD 待審批
            {pendingCount > 0 && (
              <span
                style={{
                  backgroundColor: "#ef4444",
                  color: "#fff",
                  borderRadius: "9999px",
                  padding: "0.1rem 0.4rem",
                  fontSize: "0.7rem",
                  marginLeft: "0.25rem",
                  fontWeight: 600,
                }}
              >
                {pendingCount}
              </span>
            )}
          </Button>

          <Button variant="outline" onClick={onBackupDb} style={{ fontSize: "0.825rem" }}>
            💾 備份帳套
          </Button>

          {packStatus !== "CPA_SIGNED_LOCKED" && (
            <Button variant="default" onClick={onLockPack} style={{ fontSize: "0.825rem" }}>
              ✓ 簽核並封存底稿
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
