import React from "react";

/* ==========================================================================
   Modular shadcn/ui Component Primitives
   (Card, Button, Badge, Tabs, Table, Sheet, Dialog, Progress, Input, Select)
   ========================================================================== */

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <div className={`sh-card ${className}`.trim()} {...props}>
    {children}
  </div>
);

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <div className={`sh-card-header ${className}`.trim()} {...props}>
    {children}
  </div>
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <h3 className={`sh-card-title ${className}`.trim()} {...props}>
    {children}
  </h3>
);

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <p className={`sh-card-description ${className}`.trim()} {...props}>
    {children}
  </p>
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <div className={`sh-card-content ${className}`.trim()} {...props}>
    {children}
  </div>
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <div className={`sh-card-footer ${className}`.trim()} {...props}>
    {children}
  </div>
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost";
}

export const Button: React.FC<ButtonProps> = ({
  variant = "default",
  className = "",
  children,
  ...props
}) => (
  <button className={`sh-btn sh-btn-${variant} ${className}`.trim()} {...props}>
    {children}
  </button>
);

export interface BadgeProps extends React.HTMLAttributes<HTMLElement> {
  variant?: "default" | "secondary" | "outline" | "success" | "warning";
  interactive?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = "outline",
  interactive = false,
  className = "",
  children,
  ...props
}) => {
  const classes = `sh-badge sh-badge-${variant} ${
    interactive ? "sh-badge-interactive" : ""
  } ${className}`.trim();

  if (interactive) {
    return (
      <button
        type="button"
        className={classes}
        style={{ font: "inherit", border: "inherit" }}
        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
};

export const Progress: React.FC<{ value: number }> = ({ value }) => (
  <div className="sh-progress-track">
    <div
      className="sh-progress-indicator"
      style={{ transform: `scaleX(${Math.min(1, Math.max(0, value / 100))})` }}
    />
  </div>
);

export const Sheet: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ open, onOpenChange, title, description, children }) => {
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div className="sh-overlay" onClick={() => onOpenChange(false)}>
      <div
        className="sh-sheet-content"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: 0, fontWeight: 600, fontSize: "1.1rem" }}>{title}</h2>
            {description && (
              <p style={{ margin: "0.25rem 0 0", color: "var(--muted-foreground)", fontSize: "0.85rem" }}>
                {description}
              </p>
            )}
          </div>
          <Button variant="ghost" onClick={() => onOpenChange(false)} aria-label="關閉">
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const Dialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ open, onOpenChange, title, description, children }) => {
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div className="sh-dialog-overlay" onClick={() => onOpenChange(false)}>
      <div
        className="sh-dialog-content"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 600, fontSize: "1.1rem" }}>{title}</h3>
            {description && (
              <p style={{ margin: "0.25rem 0 0", color: "var(--muted-foreground)", fontSize: "0.85rem" }}>
                {description}
              </p>
            )}
          </div>
          <Button variant="ghost" onClick={() => onOpenChange(false)} aria-label="關閉">
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
};
