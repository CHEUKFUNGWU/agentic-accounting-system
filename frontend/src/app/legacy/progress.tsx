import { cn } from "@/lib/utils";

export const Progress = ({
  value,
  className,
  tone = "ink",
}: {
  value: number;
  className?: string;
  tone?: "ink" | "ok" | "warn";
}) => (
  <div
    className={cn("h-1 w-full overflow-hidden rounded-full bg-line", className)}
    role="progressbar"
    aria-valuenow={Math.round(value)}
    aria-valuemin={0}
    aria-valuemax={100}
  >
    <div
      className={cn("h-full rounded-full transition-[width] duration-300",
        tone === "ink" && "bg-ink",
        tone === "ok" && "bg-ok",
        tone === "warn" && "bg-warn",
      )}
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    />
  </div>
);
