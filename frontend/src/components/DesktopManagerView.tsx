import React, { useState } from "react";
import { isMyGo } from "mygo-runtime";
import { DesktopBridge } from "../mygo";
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
  const [folderStatus, setFolderStatus] = useState<string | null>(null);
  const isNativeDesktop = isMyGo();

  const handleBackup = async () => {
    setBackupLoading(true);
    try {
      if (isNativeDesktop) {
        const desktopRes = await DesktopBridge.backupDatabase();
        if (desktopRes.success) {
          setLastBackupFile(desktopRes.backupPath);
          return;
        }
      }
      const res = await onBackupDb();
      if (res.backup_file) {
        setLastBackupFile(res.backup_file);
      }
    } catch (err: any) {
      console.error("Backup failed:", err);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleOpenFolder = async () => {
    if (!isNativeDesktop) {
      setFolderStatus(`帳套目錄：${filePath}`);
      return;
    }
    try {
      const openedPath = await DesktopBridge.openDataFolder();
      setFolderStatus(`已在系統檔案總管/訪達中開啟：${openedPath}`);
    } catch (err: any) {
      setFolderStatus(`無法調用系統檔案總管: ${err?.message || err}`);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <Card className="sh-card">
        <CardHeader style={{ borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <CardTitle style={{ fontSize: "1.15rem", fontWeight: 700 }}>
                帳套文件與資料管理 (Company File & Database Management)
              </CardTitle>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                本地嵌入式存儲引擎與備份管理
              </span>
            </div>
            <Badge variant="outline" style={{ fontSize: "0.75rem" }}>
              {appPlatform === "darwin" ? "macOS" : appPlatform === "win32" ? "Windows" : appPlatform}
            </Badge>
          </div>
        </CardHeader>

        <CardContent style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Storage Specs Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
            <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: "var(--radius)" }}>
              <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>存儲架構</div>
              <div style={{ fontWeight: 600, fontSize: "1.05rem", marginTop: "0.25rem" }}>{storageType}</div>
              <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>本地獨立事務日誌庫</span>
            </div>

            <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: "var(--radius)" }}>
              <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>帳套資料大小</div>
              <div style={{ fontWeight: 600, fontSize: "1.05rem", marginTop: "0.25rem" }} className="tabular-nums">
                {fileSizeFormatted}
              </div>
              <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>即時無延遲本地讀寫</span>
            </div>

            <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: "var(--radius)" }}>
              <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>執行環境</div>
              <div style={{ fontWeight: 600, fontSize: "1.05rem", marginTop: "0.25rem" }}>
                {isNativeDesktop ? "原生桌面應用程式" : "瀏覽器客戶端 (Web)"}
              </div>
              <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>本地私有數據庫</span>
            </div>
          </div>

          {/* Database File Location */}
          <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: "var(--radius)", backgroundColor: "#fafafa" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>帳套資料庫本機路徑:</div>
            <code style={{ fontSize: "0.8rem", wordBreak: "break-all", color: "#3f3f46" }}>
              {filePath}
            </code>
            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
              <Button variant="outline" onClick={handleOpenFolder} style={{ fontSize: "0.8rem" }}>
                在檔案總管中定位
              </Button>
              <Button variant="outline" onClick={() => navigator.clipboard?.writeText(filePath)} style={{ fontSize: "0.8rem" }}>
                複製路徑
              </Button>
            </div>
            {folderStatus && (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "#2563eb" }}>{folderStatus}</p>
            )}
          </div>

          {/* Manual Backup Action */}
          <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: "var(--radius)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>建立即時帳套快照備份</div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  將當前 SQLite WAL 帳套文件完整備份至本地獨立副本
                </div>
              </div>
              <Button variant="default" onClick={handleBackup} disabled={backupLoading} style={{ fontSize: "0.85rem" }}>
                {backupLoading ? "備份中..." : "立即備份帳套"}
              </Button>
            </div>

            {lastBackupFile && (
              <div
                style={{
                  marginTop: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius)",
                  backgroundColor: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  fontSize: "0.8rem",
                  color: "#166534",
                }}
              >
                備份成功：{lastBackupFile}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
