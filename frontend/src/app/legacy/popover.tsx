import * as React from "react";
import { cn } from "@/lib/utils";

/* Minimal anchored popover: absolute panel + outside-click + Escape.
   Enough for the account picker without pulling in @radix-ui/react-popover. */
export const PopoverPanel = ({
  open,
  onClose,
  className,
  children,
  anchor = "below",
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
  anchor?: "below" | "above";
}) => {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cn("anim-in absolute z-50 min-w-[320px] rounded-md border border-border bg-background shadow-[0_10px_32px_-8px_rgba(19,19,19,0.22)]",
        anchor === "below" ? "top-[calc(100%+4px)] left-0" : "bottom-[calc(100%+4px)] left-0",
        className,
      )}
    >
      {children}
    </div>
  );
};
