import * as React from "react";

import { cn } from "@/lib/utils";
import { type ViewerProps } from "@/components/viewers/shared";

/** Source with line numbers. Long lines wrap under their number: the viewer never scrolls sideways. */
export function CodeViewer({ content, compact }: ViewerProps & { content: string }) {
  const lines = React.useMemo(() => content.split("\n"), [content]);
  return (
    <pre
      className={cn("grid grid-cols-[auto_minmax(0,1fr)] font-mono leading-[1.6]", compact ? "py-2 text-xs" : "py-3 text-small")}
    >
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          <span className={cn("select-none text-right text-slate/60", compact ? "pr-2.5 pl-2" : "pr-4 pl-4")}>
            {i + 1}
          </span>
          <code className={cn("whitespace-pre-wrap wrap-anywhere", compact ? "pr-3" : "pr-6")}>{line}</code>
        </React.Fragment>
      ))}
    </pre>
  );
}
