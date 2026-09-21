import * as React from "react";
import { ArrowSquareOut, FolderOpen, X } from "@phosphor-icons/react";
import type { FileContent } from "../../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read-only view of one workspace file with line numbers. `compact` fits the narrow explorer panel. */
export function FileViewer({
  workspaceId,
  relPath,
  onClose,
  compact = false,
}: {
  workspaceId: string;
  relPath: string;
  onClose?: () => void;
  compact?: boolean;
}) {
  const { call } = useAuth();
  const { toast } = useToast();
  const [file, setFile] = React.useState<FileContent | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setFile(null);
    setError(null);
    call((t) => window.photon.readWorkspaceFile(t, workspaceId, relPath))
      .then((f) => live && setFile(f))
      .catch((err) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [call, workspaceId, relPath]);

  async function openExternal() {
    try {
      await call((t) => window.photon.openWorkspaceFileExternal(t, workspaceId, relPath));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function reveal() {
    try {
      await call((t) => window.photon.revealWorkspaceFile(t, workspaceId, relPath));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const lines = React.useMemo(() => (file && !file.binary ? file.content.split("\n") : []), [file]);
  const name = relPath.split("/").pop() ?? relPath;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex shrink-0 items-center gap-2 border-b border-border ${compact ? "h-9 px-2" : "h-10 px-4"}`}>
        <span className="min-w-0 truncate font-mono text-small" title={relPath}>
          {compact ? name : relPath}
        </span>
        {file && !compact && <span className="shrink-0 text-small text-slate">{formatBytes(file.size)}</span>}
        <span className="ml-auto flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            onClick={() => void openExternal()}
            aria-label="Open in default app"
            title="Open in default app"
          >
            <ArrowSquareOut weight="bold" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            onClick={() => void reveal()}
            aria-label="Reveal in Finder"
            title="Reveal in Finder"
          >
            <FolderOpen weight="bold" />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              onClick={onClose}
              aria-label="Close preview"
              title="Close preview"
            >
              <X weight="bold" />
            </Button>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="p-6 text-small text-destructive">{error}</p>
        ) : !file ? (
          <div className="flex flex-col gap-2 p-6">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : file.binary ? (
          <div className="p-6">
            <p className="text-body">
              <span className="font-mono">{name}</span> is a binary file ({formatBytes(file.size)}).
            </p>
            <Button className="mt-4" onClick={() => void openExternal()}>
              <ArrowSquareOut weight="bold" />
              Open in default app
            </Button>
          </div>
        ) : (
          <>
            <pre
              className={`grid grid-cols-[auto_1fr] font-mono leading-[1.6] ${compact ? "py-2 text-xs" : "py-3 text-small"}`}
            >
              {lines.map((line, i) => (
                <React.Fragment key={i}>
                  <span className={`select-none text-right text-slate/60 ${compact ? "pr-2.5 pl-2" : "pr-4 pl-4"}`}>
                    {i + 1}
                  </span>
                  <code className={`whitespace-pre ${compact ? "pr-3" : "pr-6"}`}>{line}</code>
                </React.Fragment>
              ))}
            </pre>
            {file.truncated && (
              <p className="border-t border-border px-4 py-3 text-small text-slate">
                Showing the first 1 MB of {formatBytes(file.size)}. Open it in another app for the rest.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
