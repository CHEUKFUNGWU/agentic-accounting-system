import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ink text-paper hover:bg-ink/88",
        outline: "border border-border bg-background text-foreground hover:bg-accent",
        secondary: "bg-accent text-foreground hover:bg-accent/70",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        danger: "bg-risk text-white hover:bg-risk/90",
        link: "text-foreground underline decoration-line-2 underline-offset-2 hover:decoration-ink",
      },
      size: {
        xs: "h-6 px-2 text-sm [&_svg]:size-3.5",
        sm: "h-7 px-2.5 text-sm [&_svg]:size-3.5",
        md: "h-8 px-3 text-sm [&_svg]:size-4",
        icon: "size-7 [&_svg]:size-3.5","icon-sm": "size-6 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "sm" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
