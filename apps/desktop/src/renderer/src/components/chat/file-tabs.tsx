import * as React from "react";
import { ChatCircleText, File, X } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

/** One tab in the centre column: the chat itself or an open file. */
function FileTab({
  active,
  onSelect,
  onClose,
  title,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  onClose?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={title}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      onAuxClick={(e) => e.button === 1 && onClose?.()}
      className={cn(
        "group/tab flex max-w-48 shrink-0 cursor-default items-center gap-1.5 border-r border-border px-3 text-small outline-none focus-visible:ring-2 focus-visible:ring-verdigris/25 focus-visible:ring-inset",
        active ? "bg-background text-foreground" : "bg-sheet text-slate hover:text-foreground",
      )}
    >
      <span className="flex items-center gap-1.5 truncate">{children}</span>
      {onClose && (
        <button
          type="button"
          aria-label="Close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="-mr-1 rounded p-0.5 text-slate opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100"
        >
          <X weight="bold" className="size-3" />
        </button>
      )}
    </div>
  );
}

/** Tab strip above the chat once at least one file is open. `active` null means the chat tab. */
export function FileTabs({
  files,
  active,
  onSelect,
  onClose,
}: {
  files: string[];
  active: string | null;
  onSelect: (relPath: string | null) => void;
  onClose: (relPath: string) => void;
}) {
  if (!files.length) return null;
  return (
    <div role="tablist" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border">
      <FileTab active={active === null} onSelect={() => onSelect(null)}>
        <ChatCircleText weight={active === null ? "fill" : "bold"} className="size-3.5" />
        Chat
      </FileTab>
      {files.map((p) => (
        <FileTab key={p} active={active === p} onSelect={() => onSelect(p)} onClose={() => onClose(p)} title={p}>
          <File weight="bold" className="size-3.5" />
          {p.split("/").pop()}
        </FileTab>
      ))}
    </div>
  );
}

/** Open-file state for the centre column, reset whenever `scopeKey` changes. */
export function useOpenFiles(scopeKey: string | undefined) {
  const [files, setFiles] = React.useState<string[]>([]);
  const [active, setActive] = React.useState<string | null>(null);

  const open = React.useCallback((relPath: string) => {
    setFiles((list) => (list.includes(relPath) ? list : [...list, relPath]));
    setActive(relPath);
  }, []);

  const close = React.useCallback((relPath: string) => {
    setFiles((list) => {
      const next = list.filter((p) => p !== relPath);
      // Closing the active tab moves to its neighbour, or back to the chat when none is left.
      setActive((cur) => (cur === relPath ? (next[Math.min(list.indexOf(relPath), next.length - 1)] ?? null) : cur));
      return next;
    });
  }, []);

  React.useEffect(() => {
    setFiles([]);
    setActive(null);
  }, [scopeKey]);

  return { files, active, open, close, select: setActive };
}
