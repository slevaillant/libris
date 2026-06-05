import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium cursor-pointer select-none transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.96] active:opacity-90 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:  "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        outline:  "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground shadow-sm",
        ghost:    "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-white hover:bg-destructive/90 shadow-sm",
      },
      size: {
        sm:   "h-7 px-3",
        md:   "h-9 px-4",
        lg:   "h-10 px-6 text-sm",
        icon: "h-7 w-7",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
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
