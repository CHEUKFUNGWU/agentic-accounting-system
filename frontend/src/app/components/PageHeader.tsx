import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * One header pattern for all six pages.
 *
 * Title on the left, the page's primary action on the right, and an optional
 * toolbar row underneath for search, filters or view settings. Fixed heights
 * (56 / 40) so switching pages does not move the content, and no page invents
 * its own arrangement — the previous build had six different ones, two of them
 * stacked on top of each other.
 */
export function PageHeader({
  title,
  actions,
  toolbar,
}: {
  title: string
  actions?: React.ReactNode
  toolbar?: React.ReactNode
}) {
  return (
    <div className="shrink-0 border-b">
      <div className="flex h-14 items-center justify-between gap-4 px-4">
        <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {toolbar ? (
        <div className={cn("flex h-10 items-center gap-2 border-t bg-muted/30 px-4")}>{toolbar}</div>
      ) : null}
    </div>
  )
}
