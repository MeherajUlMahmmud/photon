import { cn } from "@/lib/utils";
import { type ViewerProps } from "@/components/viewers/shared";

/** Plain text as wrapped prose: no line numbers, no horizontal scroll. */
export function TextViewer({ content, compact }: ViewerProps & { content: string }) {
  return (
    <pre
      className={cn(
        "font-sans whitespace-pre-wrap wrap-break-word leading-[1.6]",
        compact ? "p-3 text-small" : "p-6 text-body",
      )}
    >
      {content}
    </pre>
  );
}
