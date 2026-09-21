import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-sheet px-3 py-2 text-body text-foreground transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-slate/70 disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-verdigris focus-visible:ring-2 focus-visible:ring-verdigris/25",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
