import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-body font-medium outline-none press focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-black text-sheet hover:bg-black/85",
        outline: "border border-input bg-sheet text-foreground hover:border-black",
        ghost: "text-slate hover:bg-muted hover:text-foreground",
        granted: "bg-verdigris text-sheet hover:bg-verdigris-deep",
        quiet: "text-slate underline decoration-input underline-offset-4 hover:text-foreground hover:decoration-black",
        link: "text-foreground underline decoration-input underline-offset-4 hover:decoration-black",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-3 text-small",
        lg: "h-10 px-5",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
