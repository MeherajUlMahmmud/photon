import * as React from "react";

import { cn, errorMessage } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export type ViewerKind = "image" | "pdf" | "markdown" | "text" | "code";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const MARKDOWN_EXT = new Set(["md", "markdown", "mdx"]);
const TEXT_EXT = new Set(["txt", "log", "text", "rtf", "csv", "tsv"]);

/** Which viewer handles a path, by extension (and a few well-known bare names). */
export function viewerKindOf(relPath: string): ViewerKind {
  const name = relPath.split("/").pop() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (MARKDOWN_EXT.has(ext)) return "markdown";
  if (TEXT_EXT.has(ext) || (!ext && /^(readme|license|licence|notice|authors|changelog)$/i.test(name))) return "text";
  return "code";
}

/** URL the main process serves workspace bytes from; see `photon-file` in main/index.ts. */
export function workspaceFileUrl(workspaceId: string, relPath: string): string {
  return `photon-file://${workspaceId}/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Loads a value for the current file; resets while the path changes. `load` null means nothing to load. */
export function useFileLoad<T>(load: (() => Promise<T>) | null, deps: React.DependencyList) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    if (!load) return;
    load()
      .then((v) => live && setData(v))
      .catch((err) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

/** Props every viewer body takes. `compact` fits the narrow explorer panel. */
export type ViewerProps = { compact: boolean };

export function ViewerLoading({ compact }: ViewerProps) {
  return (
    <div className={cn("flex flex-col gap-2", compact ? "p-3" : "p-6")}>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}

export function ViewerProblem({ children, compact }: ViewerProps & { children: React.ReactNode }) {
  return <p className={cn("text-small text-destructive", compact ? "p-3" : "p-6")}>{children}</p>;
}
