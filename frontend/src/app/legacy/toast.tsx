import * as React from "react";
import { cn } from "@/lib/utils";

type Toast = { id: number; title: string; description?: string; tone?: "ink" | "ok" | "warn" };
type ToastContextValue = { push: (t: Omit<Toast, "id">) => void };

const ToastContext = React.createContext<ToastContextValue>({ push: () => {} });

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { ...t, id }]);
    window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {/* Bottom-right, above the status bar: never covers the statement. */}
      <div className="pointer-events-none fixed right-4 bottom-10 z-[60] flex w-[320px] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn("anim-in pointer-events-auto rounded-md border bg-background px-3 py-2 shadow-[0_10px_32px_-8px_rgba(19,19,19,0.22)]",
              t.tone === "ok" && "border-ok-line",
              t.tone === "warn" && "border-warn-line",
              (!t.tone || t.tone === "ink") && "border-border",
            )}
          >
            <div className="text-sm font-medium text-foreground">{t.title}</div>
            {t.description && <div className="mt-0.5 text-sm text-muted-foreground">{t.description}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => React.useContext(ToastContext);
