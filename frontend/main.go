package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/egoist/mygo"
)

// DesktopInfo describes the desktop environment and local storage paths.
type DesktopInfo struct {
	OS           string `json:"os"`
	Arch         string `json:"arch"`
	GoVersion    string `json:"goVersion"`
	AppName      string `json:"appName"`
	Version      string `json:"version"`
	AppDataDir   string `json:"appDataDir"`
	DatabasePath string `json:"databasePath"`
}

// BackupResult describes the result of a local company file backup.
type BackupResult struct {
	Success      bool   `json:"success"`
	BackupPath   string `json:"backupPath"`
	OriginalPath string `json:"originalPath"`
	SizeBytes    int64  `json:"sizeBytes"`
	Timestamp    string `json:"timestamp"`
	Message      string `json:"message"`
}

// BackendHealth describes connectivity to the local Python accounting daemon.
type BackendHealth struct {
	Connected    bool   `json:"connected"`
	StatusCode   int    `json:"statusCode"`
	CompanyFile  string `json:"companyFile"`
	ErrorMessage string `json:"errorMessage"`
}

// DesktopBridge is exposed to the frontend via TypeScript bindings (mygo generate).
type DesktopBridge struct{}

// resolveDataPaths returns the data directory and primary database file path.
func (d DesktopBridge) resolveDataPaths() (string, string) {
	var baseDir string
	if runtime.GOOS == "windows" {
		appData := os.Getenv("APPDATA")
		if appData == "" {
			appData = os.Getenv("USERPROFILE")
		}
		baseDir = filepath.Join(appData, "AgenticAccounting")
	} else if runtime.GOOS == "darwin" {
		home, _ := os.UserHomeDir()
		baseDir = filepath.Join(home, "Library", "Application Support", "AgenticAccounting")
	} else {
		configDir, err := os.UserConfigDir()
		if err != nil {
			home, _ := os.UserHomeDir()
			baseDir = filepath.Join(home, ".config", "AgenticAccounting")
		} else {
			baseDir = filepath.Join(configDir, "AgenticAccounting")
		}
	}
	dbPath := filepath.Join(baseDir, "ledger.db")
	return baseDir, dbPath
}

// GetInfo returns machine and local database storage paths.
func (d DesktopBridge) GetInfo() DesktopInfo {
	dataDir, dbPath := d.resolveDataPaths()
	return DesktopInfo{
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		GoVersion:    runtime.Version(),
		AppName:      "Agentic Accounting System",
		Version:      "0.4.0",
		AppDataDir:   dataDir,
		DatabasePath: dbPath,
	}
}

// OpenDataFolder opens the local OS file manager (Finder/Explorer) showing the SQLite database directory.
func (d DesktopBridge) OpenDataFolder() string {
	dataDir, _ := d.resolveDataPaths()
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Sprintf("Error creating data dir: %v", err)
	}
	_ = mygo.Shell.OpenPath(dataDir)
	return dataDir
}

// BackupDatabase creates an instant timestamped snapshot of the SQLite ledger.
func (d DesktopBridge) BackupDatabase() BackupResult {
	dataDir, dbPath := d.resolveDataPaths()
	nowStr := time.Now().Format("20060102_150405")
	backupsDir := filepath.Join(dataDir, "backups")
	_ = os.MkdirAll(backupsDir, 0755)

	backupPath := filepath.Join(backupsDir, fmt.Sprintf("ledger_backup_%s.db", nowStr))

	srcFile, err := os.Open(dbPath)
	if err != nil {
		return BackupResult{
			Success:      false,
			OriginalPath: dbPath,
			Message:      fmt.Sprintf("Failed to open source DB: %v", err),
		}
	}
	defer srcFile.Close()

	destFile, err := os.Create(backupPath)
	if err != nil {
		return BackupResult{
			Success:      false,
			OriginalPath: dbPath,
			Message:      fmt.Sprintf("Failed to create backup target: %v", err),
		}
	}
	defer destFile.Close()

	bytesWritten, err := io.Copy(destFile, srcFile)
	if err != nil {
		return BackupResult{
			Success:      false,
			OriginalPath: dbPath,
			Message:      fmt.Sprintf("Error copying DB bytes: %v", err),
		}
	}

	return BackupResult{
		Success:      true,
		BackupPath:   backupPath,
		OriginalPath: dbPath,
		SizeBytes:    bytesWritten,
		Timestamp:    nowStr,
		Message:      "Database snapshot created successfully",
	}
}

// CheckBackendHealth verifies communication with the Python FastAPI / MCP service.
func (d DesktopBridge) CheckBackendHealth() BackendHealth {
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:8000/api/v1/desktop/company-file")
	if err != nil {
		return BackendHealth{
			Connected:    false,
			StatusCode:   0,
			ErrorMessage: err.Error(),
		}
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	return BackendHealth{
		Connected:   resp.StatusCode == 200,
		StatusCode:  resp.StatusCode,
		CompanyFile: string(bodyBytes),
	}
}

func main() {
	bridge := DesktopBridge{}
	mygo.BindAs("DesktopBridge", bridge)

	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:           "Agentic Accounting System (企業級智能審計核算系統)",
			Width:           1360,
			Height:          880,
			MinWidth:        1080,
			MinHeight:       700,
			BackgroundColor: "light-dark(#ffffff, #09090b)",
			StateKey:        "agentic-accounting-main-window",
			URL:             "/",
		})
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
