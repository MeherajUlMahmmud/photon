import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/markdown";
import { type ViewerProps } from "@/components/viewers/shared";

/** Rendered Markdown, using the same renderer as chat replies. */
export function MarkdownViewer({ content, compact }: ViewerProps & { content: string }) {
  return (
    <div className={cn("max-w-3xl", compact ? "p-3 text-small" : "p-6")}>
      <Markdown>{content}</Markdown>
    </div>
  );
}
