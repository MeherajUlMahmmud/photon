import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** A note in the margin: a rule on the left, plain text. Problems are stated, not colored. */
const alertVariants = cva("grid w-full gap-0.5 border-l-2 py-1 pl-3.5 text-body", {
  variants: {
    variant: {
      default: "border-input text-foreground",
      problem: "border-black text-foreground",
      granted: "border-verdigris text-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("font-medium", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("text-body text-slate [&_a]:text-foreground", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
