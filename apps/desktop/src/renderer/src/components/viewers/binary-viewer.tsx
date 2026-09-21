import { ArrowSquareOut } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { formatBytes, type ViewerProps } from "@/components/viewers/shared";

/** Nothing to show inline; hand the file to the OS. */
export function BinaryViewer({
  name,
  size,
  onOpenExternal,
  compact,
}: ViewerProps & { name: string; size: number; onOpenExternal: () => void }) {
  return (
    <div className={compact ? "p-3" : "p-6"}>
      <p className="text-body">
        <span className="font-mono">{name}</span> is a binary file ({formatBytes(size)}).
      </p>
      <Button className="mt-4" size={compact ? "sm" : "default"} onClick={onOpenExternal}>
        <ArrowSquareOut weight="bold" />
        Open in default app
      </Button>
    </div>
  );
}
