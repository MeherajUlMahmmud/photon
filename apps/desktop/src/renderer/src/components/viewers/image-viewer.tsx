import * as React from "react";

import { cn } from "@/lib/utils";
import { formatBytes, ViewerProblem, type ViewerProps } from "@/components/viewers/shared";

/** Fit-to-panel image on a checkerboard, with natural dimensions in the footer. */
export function ImageViewer({ src, name, size, compact }: ViewerProps & { src: string; name: string; size?: number }) {
  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setDims(null);
    setFailed(false);
  }, [src]);

  if (failed) return <ViewerProblem compact={compact}>Could not load this image.</ViewerProblem>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center overflow-auto",
          compact ? "p-2" : "p-6",
          // Checkerboard so transparent regions read as transparent.
          "bg-[linear-gradient(45deg,var(--sheet)_25%,transparent_25%,transparent_75%,var(--sheet)_75%),linear-gradient(45deg,var(--sheet)_25%,transparent_25%,transparent_75%,var(--sheet)_75%)] bg-size-[16px_16px] bg-position-[0_0,8px_8px]",
        )}
      >
        <img
          src={src}
          alt={name}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <p className="shrink-0 border-t border-border px-3 py-1.5 font-mono text-xs text-slate">
        {dims ? `${dims.w} × ${dims.h}` : "…"}
        {size != null && ` · ${formatBytes(size)}`}
      </p>
    </div>
  );
}
