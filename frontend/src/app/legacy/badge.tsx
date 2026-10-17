import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-xs border px-1.5 py-px text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-border bg-muted text-muted-foreground",
        mono: "border-border bg-background font-mono text-xs text-muted-foreground",
        ok: "border-ok-line bg-ok-bg text-ok",
        warn: "border-warn-line bg-warn-bg text-warn",
        risk: "border-risk-line bg-risk-bg text-risk",
        ink: "border-ink bg-ink text-paper",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
);
