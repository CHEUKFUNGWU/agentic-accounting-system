import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn("inline-flex items-center gap-0.5 rounded-md bg-accent/70 p-0.5", className)}
    {...props}
  />
);

export const TabsTrigger = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn("inline-flex h-6 items-center rounded-sm px-2.5 text-sm font-medium text-muted-foreground transition-colors","hover:text-foreground","data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_1px_rgba(19,19,19,0.06)]",
      className,
    )}
    {...props}
  />
);

export const TabsContent = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />
);
