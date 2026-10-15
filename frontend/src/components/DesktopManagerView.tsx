import React, { useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";

interface DesktopManagerViewProps {
  storageType: string;
  filePath: string;
  fileSizeFormatted: string;
  appPlatform: string;
  onBackupDb: () => Promise<{ backup_file?: string }>;
}

export const DesktopManagerView: React.FC<DesktopManagerViewProps> = ({
  storageType,
  filePath,
  fileSizeFormatted,
  appPlatform,
  onBackupDb,
}) => {
  const [backupLoading, setBackupLoading] = useState(false);
  const [lastBackupFile, setLastBackupFile] = useState<string | null>(null);

  const handleBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await onBackupDb();
      if (res.backup_file) {
        setLastBackupFile(res.backup_file);
      }
    } finally {
      setBackupLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <Card className="sh-card">
        <CardHeader>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <CardTitle style={{ fontSize: "1.1rem" }}>
                桌面端帳套文件管理 (Desktop Company File & Offline Vault)
              </CardTitle>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                基於 MyGo 跨平台桌面引擎與 SQLite WAL 嵌入式數據庫 • 零運維、開箱即用、離線優先
              </span>
            </div>
            <Badge variant="default" style={{ fontSize: "0.75rem" }}>
              MyGo Desktop (macOS / Windows)
            </Badge>
          </div>
        </CardHeader>

        <CardContent style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Storage Specs Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
            <div style={{ border: "1px solid var(--border)", padding: "0.75rem", borderRadius: "var(--radius)" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>存儲引擎架構</div>
              <div style={{ fontWeight: 600, fontSize: "0.95rem", marginTop: "0.2rem" }}>{storageType}</div>
              <span style={{ fontSize: "0.7rem", color: "#16a34a" }}>支持高併發讀寫無鎖鎖定</span>
            </div>

            <div style={{ border: "1px solid var(--border)", padding: "0.75rem", borderRadius: "var(--radius)" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>本機帳套大小 (DB Size)</div>
              <div style={{ fontWeight: 600, fontSize: "0.95rem", marginTop: "0.2rem" }} className="tabular-nums">
                {fileSizeFormatted}
              </div>
              <span style={{ fontSize: "0.7rem", color: "var(--muted-foreground)" }}>毫秒級加載，極低內存佔用</span>
            </div>

            <div style={{ border: "1px solid var(--border)", padding: "0.75rem", borderRadius: "var(--radius)" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>當前操作系統平台</div>
              <div style={{ fontWeight: 600, fontSize: "0.95rem", marginTop: "0.2rem" }}>
                {appPlatform === "darwin" ? "Apple macOS (WKWebView)" : appPlatform === "win32" ? "Microsoft Windows (WebView2)" : appPlatform}
              </div>
              <span style={{ fontSize: "0.7rem", color: "#2563eb" }}>原生系統渲染無外掛 Chromium</span>
            </div>
          </div>

          {/* Database File Location */}
          <div style={{ border: "1px solid var(--border)", padding: "0.875rem", borderRadius: "var(--radius)", backgroundColor: "#fafafa" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem" }}>
              📂 本地公司帳套文件路徑 (Local Company Database Location):
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.8rem", wordBreak: "break-all", color: "var(--foreground)" }}>
              {filePath}
            </div>
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
              所有日記帳、延伸試算表、公私混用拆分記錄與 SHA-256 防偽鏈均存儲於此本機文件中，不受任何服務器重啟影響，數據主權 100% 歸創辦人所有。
            </p>
          </div>

          {/* Action Area */}
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", paddingTop: "0.5rem" }}>
            <Button variant="default" onClick={handleBackup} disabled={backupLoading}>
              {backupLoading ? "備份生成中..." : "💾 一鍵生成帳套備份快照 (.db)"}
            </Button>
          </div>

          {lastBackupFile && (
            <div style={{ padding: "0.75rem", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "var(--radius)", fontSize: "0.8rem", color: "#166534" }}>
              ✓ 備份成功！快照文件已生成至：
              <div style={{ fontFamily: "monospace", marginTop: "0.25rem", wordBreak: "break-all" }}>
                {lastBackupFile}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
