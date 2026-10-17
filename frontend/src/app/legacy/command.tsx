import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "./dialog";

export const Command = CommandPrimitive;

export const CommandDialog = ({ children, open, onOpenChange }: {
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="top-[12%] max-w-[560px] p-0" aria-describedby={undefined}>
      <CommandPrimitive className="flex flex-col">{children}</CommandPrimitive>
    </DialogContent>
  </Dialog>
);

export const CommandInput = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) => (
  <div className="border-b flex items-center gap-2 px-3">
    <Search className="size-3.5 text-muted-foreground" />
    <CommandPrimitive.Input
      className={cn("h-10 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  </div>
);

export const CommandList = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) => (
  <CommandPrimitive.List className={cn("max-h-[340px] overflow-y-auto p-1", className)} {...props} />
);

export const CommandEmpty = (props: React.ComponentProps<typeof CommandPrimitive.Empty>) => (
  <CommandPrimitive.Empty className="px-3 py-6 text-center text-sm text-muted-foreground" {...props} />
);

export const CommandGroup = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) => (
  <CommandPrimitive.Group
    className={cn("overflow-hidden text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase",
      className,
    )}
    {...props}
  />
);

export const CommandItem = ({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) => (
  <CommandPrimitive.Item
    className={cn("flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-sm text-foreground outline-none select-none","data-[selected=true]:bg-accent [&_svg]:size-3.5 [&_svg]:text-muted-foreground",
      className,
    )}
    {...props}
  />
);

export const CommandSeparator = (props: React.ComponentProps<typeof CommandPrimitive.Separator>) => (
  <CommandPrimitive.Separator className="my-1 h-px bg-line" {...props} />
);
