import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) => (
  <SelectPrimitive.Trigger
    className={cn("inline-flex h-7 items-center justify-between gap-2 rounded-sm px-2 text-sm text-foreground transition-colors","hover:bg-accent data-[placeholder]:text-muted-foreground",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-3.5 text-muted-foreground" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);

export const SelectContent = ({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      position={position}
      sideOffset={4}
      className={cn("anim-in z-50 max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-background p-1 shadow-[0_10px_32px_-8px_rgba(19,19,19,0.22)]",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
);

export const SelectItem = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) => (
  <SelectPrimitive.Item
    className={cn("relative flex h-7 cursor-default items-center gap-2 rounded-sm pr-6 pl-2 text-sm text-foreground outline-none select-none","data-[highlighted]:bg-accent data-[disabled]:opacity-45",
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-1.5">
      <Check className="size-3.5" />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
);

export const SelectLabel = ({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) => (
  <SelectPrimitive.Label className={cn("px-2 py-1 text-xs text-muted-foreground uppercase", className)} {...props} />
);

export const SelectSeparator = ({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) => (
  <SelectPrimitive.Separator className={cn("my-1 h-px bg-line", className)} {...props} />
);
