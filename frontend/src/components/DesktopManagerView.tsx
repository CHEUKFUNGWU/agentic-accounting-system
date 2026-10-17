import React, { useState } from "react";
import { isMyGo } from "mygo-runtime";
import { DesktopBridge } from "../mygo";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "./ui/shadcn";
import { useI18n, pick } from "../i18n";

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
  const { t, lang } = useI18n();
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
      setFolderStatus(`${t.card_path}：${filePath}`);
      return;
    }
    try {
      const openedPath = await DesktopBridge.openDataFolder();
      setFolderStatus(`${lang === "en" ? "Opened in file manager: " : lang === "zh-CN" ? "已在文件管理器中打开：" : "已在檔案總管中開啟："}${openedPath}`);
    } catch (err: any) {
      setFolderStatus(`${pick(lang, { en: "Failed to open folder: ", "zh-CN": "无法打开文件夹: ", "zh-TW": "無法開啟資料夾: " })}${err?.message || err}`);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <Card className="sh-card">
        <CardHeader style={{ borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <CardTitle style={{ fontSize: "1.15rem", fontWeight: 700 }}>
                {t.db_view_title}
              </CardTitle>
              <span style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                {t.db_view_subtitle}
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
              <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>{t.card_engine}</div>
              <div style={{ fontWeight: 600, fontSize: "1.05rem", marginTop: "0.25rem" }}>{storageType}</div>
              <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                {storageType.includes("PostgreSQL")
                  ? (lang === "en" ? "Enterprise Multi-Tenant ACID Cluster" : lang === "zh-CN" ? "企业级高并发 ACID 集群" : "企業級高併發 ACID 集群")
                  : (lang === "en" ? "Embedded Local Transaction Ledger" : lang === "zh-CN" ? "本地嵌入式事务日志库" : "本地嵌入式事務日誌庫")}
              </span>
            </div>

            <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: "var(--radius)" }}>
              <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>{t.card_size}</div>
              <div style={{ fontWeight: 600, fontSize: "1.05rem", marginTop: "0.25rem" }} className="tabular-nums">
                {fileSizeFormatted}
              </div>
              <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                {storageType.includes("PostgreSQL") ? (lang === "en" ? "Managed Cloud RDS / Cluster" : lang === "zh-CN" ? "云端托管数据库" : "雲端託管資料庫") : (lang === "en" ? "Low Latency Local I/O" : lang === "zh-CN" ? "低延迟本地读写" : "低延遲本地讀寫")}
              </span>
            </div>

            <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: "var(--radius)" }}>
              <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                {lang === "en" ? "Runtime Environment" : lang === "zh-CN" ? "运行环境" : "執行環境"}
              </div>
              <div style={{ fontWeight: 600, fontSize: "1.05rem", marginTop: "0.25rem" }}>
                {isNativeDesktop ? (lang === "en" ? "Desktop Native (MyGo)" : lang === "zh-CN" ? "原生桌面应用" : "原生桌面應用程式") : (lang === "en" ? "Web Client" : lang === "zh-CN" ? "浏览器客户端 (Web)" : "瀏覽器客戶端 (Web)")}
              </div>
              <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
                {storageType.includes("PostgreSQL") ? "PostgreSQL 16+" : "SQLite WAL"}
              </span>
            </div>
          </div>

          {/* Database File / Connection Location */}
          <div style={{ border: "1px solid var(--border)", padding: "1rem", borderRadius: "var(--radius)", backgroundColor: "#fafafa" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>{t.card_path}:</div>
            <code style={{ fontSize: "0.8rem", wordBreak: "break-all", color: "#3f3f46" }}>
              {filePath}
            </code>
            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
              <Button variant="outline" onClick={handleOpenFolder} style={{ fontSize: "0.8rem" }}>
                {lang === "en" ? "Reveal in Explorer" : lang === "zh-CN" ? "在文件管理器中定位" : "在檔案總管中定位"}
              </Button>
              <Button variant="outline" onClick={() => navigator.clipboard?.writeText(filePath)} style={{ fontSize: "0.8rem" }}>
                {t.copy_path}
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
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{t.backup_snapshot_title}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  {t.backup_snapshot_desc}
                </div>
              </div>
              <Button variant="default" onClick={handleBackup} disabled={backupLoading} style={{ fontSize: "0.85rem" }}>
                {backupLoading ? t.backup_in_progress : t.backup_now}
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
                {lang === "en" ? "Backup created successfully: " : lang === "zh-CN" ? "备份成功：" : "備份成功："}{lastBackupFile}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
