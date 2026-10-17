import React from "react";

/* ==========================================================================
   Error boundary.

   A single `null` account balance used to white-screen the entire application
   (see the schedule views). An accounting ledger that disappears is worse
   than one that says "this panel failed" — the CPA needs to know what broke,
   keep the rest of the pack usable, and get a copy of the details.
   ========================================================================== */

interface Props {
  children: React.ReactNode;
  /** Shown in the fallback headline. */
  scope?: string;
}

interface State {
  error: Error | null;
  info: string | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  private reset = () => this.setState({ error: null, info: null });

  private copyDetails = () => {
    const { error, info } = this.state;
    const payload = `${error?.name ?? "Error"}: ${error?.message ?? "unknown"}\n\n${error?.stack ?? ""}\n\nComponent stack:${info ?? ""}`;
    void navigator.clipboard?.writeText(payload);
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          margin: "1.5rem auto",
          maxWidth: "720px",
          padding: "1.25rem 1.5rem",
          border: "1px solid #fecaca",
          backgroundColor: "#fff",
          borderRadius: "var(--radius)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        }}
      >
        <div style={{ fontSize: "1rem", fontWeight: 700, color: "#b91c1c" }}>
          此面板載入失敗 · This panel failed to render
        </div>
        <p style={{ margin: "0.35rem 0 0.75rem", fontSize: "0.85rem", color: "var(--muted-foreground)" }}>
          {this.props.scope ? `${this.props.scope} — ` : ""}
          其餘賬套資料不受影響，可切換分頁繼續作業。請把以下訊息回報給工程團隊。
        </p>
        <pre
          style={{
            margin: 0,
            padding: "0.75rem",
            backgroundColor: "#f4f4f5",
            borderRadius: "var(--radius)",
            fontSize: "0.75rem",
            maxHeight: "220px",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {error.name}: {error.message}
          {info ? `\n${info.split("\n").slice(0, 6).join("\n")}` : ""}
        </pre>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <button type="button" className="sh-btn sh-btn-default" onClick={this.reset} style={{ fontSize: "0.85rem" }}>
            重試 · Retry
          </button>
          <button type="button" className="sh-btn sh-btn-outline" onClick={this.copyDetails} style={{ fontSize: "0.85rem" }}>
            複製錯誤詳情 · Copy details
          </button>
        </div>
      </div>
    );
  }
}
