import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Page frame. The title states the situation in a sentence ("Working in
 * photon", "Choose a folder to work in"), so there is no label above it.
 */
export function Page({
  title,
  lede,
  actions,
  children,
  className,
  width = "default",
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  width?: "default" | "wide";
}) {
  return (
    <section className={cn("animate-rise px-8 pt-14 pb-20 md:px-14", width === "default" ? "max-w-[68ch]" : "max-w-6xl", className)}>
      <header className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-[40ch]">
          <h1 className="text-display text-balance">{title}</h1>
          {lede && <p className="mt-3 text-lead text-slate">{lede}</p>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("text-section", className)}>{children}</h2>;
}

/**
 * Facts as a two-column list: term on the left, value on the right. Used
 * instead of cards wherever the content is a set of named values.
 */
export function Facts({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-[9rem_1fr] gap-x-6 gap-y-3 text-body", className)}>{children}</dl>;
}

export function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="max-w-[48ch] py-6">
      <p className="text-lead">{title}</p>
      {description && <p className="mt-1 text-body text-slate">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
