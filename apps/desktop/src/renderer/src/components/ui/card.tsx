import * as React from "react";

import { cn } from "@/lib/utils";

/** A white sheet on the chalk page. No shadow, no hover lift; used sparingly. */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card" className={cn("flex flex-col gap-4 rounded-lg bg-card p-6 text-card-foreground", className)} {...props} />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("text-lead font-medium", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-body text-slate", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("flex flex-col gap-3", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center gap-2 pt-1", className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
