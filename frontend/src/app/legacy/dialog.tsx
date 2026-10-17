import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-50 bg-ink/35" />
    <DialogPrimitive.Content
      className={cn("anim-in fixed top-[16%] left-1/2 z-50 w-full max-w-[520px] -translate-x-1/2","rounded-lg border border-border bg-background shadow-[0_16px_48px_-12px_rgba(19,19,19,0.28)]",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="關閉"
        className="absolute top-3 right-3 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
);

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("border-b px-4 py-3", className)} {...props} />
);

export const DialogTitle = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn("text-base font-semibold text-foreground", className)} {...props} />
);

export const DialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description className={cn("mt-0.5 text-sm text-muted-foreground", className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("border-t flex items-center justify-end gap-2 px-4 py-3", className)} {...props} />
);
