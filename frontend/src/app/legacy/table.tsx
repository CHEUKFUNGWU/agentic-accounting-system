import * as React from "react";
import { cn } from "@/lib/utils";

export const TableShell = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("w-full overflow-auto", className)} {...props} />
);

export const Table = ({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <table className={cn("w-full border-collapse text-sm", className)} {...props} />
);

export const THead = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn("sticky top-0 z-10 bg-muted", className)} {...props} />
);

export const TBody = (props: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />;

export const TR = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn("group/row", className)} {...props} />
);

export const TH = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn("border-b h-8 px-3 text-left align-middle text-xs font-semibold text-muted-foreground uppercase",
      className,
    )}
    {...props}
  />
);

export const TD = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("h-[var(--row-h)] px-3 align-middle", className)} {...props} />
);
