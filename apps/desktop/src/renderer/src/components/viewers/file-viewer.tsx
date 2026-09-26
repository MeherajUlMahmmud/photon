import * as React from "react";
import { ArrowSquareOut, Code, FolderOpen, TextAa, X } from "@phosphor-icons/react";
import type { FileContent, FileStat } from "../../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BinaryViewer } from "@/components/viewers/binary-viewer";
import { CodeViewer } from "@/components/viewers/code-viewer";
import { ImageViewer } from "@/components/viewers/image-viewer";
import { MarkdownViewer } from "@/components/viewers/markdown-viewer";
import { PdfViewer } from "@/components/viewers/pdf-viewer";
import {
  formatBytes,
  useFileLoad,
  viewerKindOf,
  ViewerLoading,
  ViewerProblem,
  workspaceFileUrl,
} from "@/components/viewers/shared";
import { TextViewer } from "@/components/viewers/text-viewer";

function HeaderButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-7"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

/**
 * Read-only view of one workspace file: header with actions, body from the
 * viewer matching the file's kind. Images and PDFs stream straight from disk
 * over `photon-file://`; everything else is read as text. Markdown renders
 * with a toggle to see the source. `compact` fits the narrow explorer panel.
 */
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
  const kind = viewerKindOf(relPath);
  const name = relPath.split("/").pop() ?? relPath;
  const streamed = kind === "image" || kind === "pdf";
  const [showSource, setShowSource] = React.useState(false);

  const stat = useFileLoad<FileStat>(
    streamed ? () => call((t) => window.photon.statWorkspaceFile(t, workspaceId, relPath)) : null,
    [call, workspaceId, relPath, streamed],
  );
  const text = useFileLoad<FileContent>(
    streamed ? null : () => call((t) => window.photon.readWorkspaceFile(t, workspaceId, relPath)),
    [call, workspaceId, relPath, streamed],
  );
  React.useEffect(() => setShowSource(false), [relPath]);

  const size = streamed ? stat.data?.size : text.data?.size;
  const error = stat.error ?? text.error;
  const file = text.data;

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

  let body: React.ReactNode;
  if (error) {
    body = <ViewerProblem compact={compact}>{error}</ViewerProblem>;
  } else if (kind === "image") {
    body = <ImageViewer src={workspaceFileUrl(workspaceId, relPath)} name={name} size={size} compact={compact} />;
  } else if (kind === "pdf") {
    body = <PdfViewer src={workspaceFileUrl(workspaceId, relPath)} name={name} />;
  } else if (!file) {
    body = <ViewerLoading compact={compact} />;
  } else if (file.binary) {
    body = <BinaryViewer name={name} size={file.size} onOpenExternal={() => void openExternal()} compact={compact} />;
  } else if (kind === "markdown" && !showSource) {
    body = <MarkdownViewer content={file.content} compact={compact} />;
  } else if (kind === "text") {
    body = <TextViewer content={file.content} compact={compact} />;
  } else {
    body = <CodeViewer content={file.content} compact={compact} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn("flex shrink-0 items-center gap-2 border-b border-border", compact ? "h-9 px-2" : "h-10 px-4")}
      >
        <span className="min-w-0 truncate font-mono text-small" title={relPath}>
          {compact ? name : relPath}
        </span>
        {size != null && !compact && <span className="shrink-0 text-small text-slate">{formatBytes(size)}</span>}
        <span className="ml-auto flex shrink-0 items-center">
          {kind === "markdown" && file && !file.binary && (
            <HeaderButton
              label={showSource ? "Show rendered" : "Show source"}
              pressed={showSource}
              onClick={() => setShowSource((s) => !s)}
            >
              {showSource ? <TextAa weight="bold" /> : <Code weight="bold" />}
            </HeaderButton>
          )}
          <HeaderButton label="Open in default app" onClick={() => void openExternal()}>
            <ArrowSquareOut weight="bold" />
          </HeaderButton>
          <HeaderButton label="Reveal in Finder" onClick={() => void reveal()}>
            <FolderOpen weight="bold" />
          </HeaderButton>
          {onClose && (
            <HeaderButton label="Close preview" onClick={onClose}>
              <X weight="bold" />
            </HeaderButton>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {body}
        {file?.truncated && (
          <p className="border-t border-border px-4 py-3 text-small text-slate">
            Showing the first 1 MB of {formatBytes(file.size)}. Open it in another app for the rest.
          </p>
        )}
      </div>
    </div>
  );
}
