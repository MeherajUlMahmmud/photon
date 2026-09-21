import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Badges encode state, not decoration. `granted` is the only one with color:
 * it marks access Photon has (a key saved, a folder it may write to).
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-px text-small leading-[1.5] [&>svg]:size-3",
  {
    variants: {
      variant: {
        granted: "bg-verdigris-wash text-verdigris-deep",
        muted: "bg-muted text-slate",
        outline: "border border-input text-slate",
        failed: "bg-black text-sheet",
      },
    },
    defaultVariants: {
      variant: "muted",
    },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
