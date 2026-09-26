import * as React from "react";
import { ArrowSquareOut, CaretRight, Copy, File, Folder, FolderOpen, SidebarSimple } from "@phosphor-icons/react";
import type { DirEntry, Tokens, WithTokens } from "../../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { FileViewer } from "@/components/viewers";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const EXPLORER_WIDTH = { fallback: 288, min: 200, max: 640 };
/** The chat beside the panel never gets narrower than this; the panel gives way instead of running off-screen. */
const CHAT_MIN_WIDTH = 480;

type ExplorerContextValue = {
  onOpenFile: (relPath: string) => void;
  activePath: string | null;
};
const ExplorerContext = React.createContext<ExplorerContextValue>({ onOpenFile: () => {}, activePath: null });

type NodeProps = { workspaceId: string; relPath: string; depth: number };

/** One directory level, loaded when first expanded. */
function DirChildren({ workspaceId, relPath, depth }: NodeProps) {
  const { call } = useAuth();
  const [entries, setEntries] = React.useState<DirEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setEntries(null);
    setError(null);
    call((t) => window.photon.listWorkspaceDir(t, workspaceId, relPath))
      .then((list) => live && setEntries(list))
      .catch((err) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [call, workspaceId, relPath]);

  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  if (error) {
    return (
      <p className="py-1 text-small text-slate" style={pad}>
        {error}
      </p>
    );
  }
  if (!entries) {
    return (
      <div className="flex flex-col gap-1.5 py-1" style={pad}>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }
  if (!entries.length) {
    return (
      <p className="py-1 text-small text-slate" style={pad}>
        Empty
      </p>
    );
  }
  return (
    <ul>
      {entries.map((e) => (
        <Entry
          key={e.name}
          entry={e}
          workspaceId={workspaceId}
          relPath={relPath ? `${relPath}/${e.name}` : e.name}
          depth={depth}
        />
      ))}
    </ul>
  );
}

function Entry({ entry, workspaceId, relPath, depth }: { entry: DirEntry } & NodeProps) {
  const { call } = useAuth();
  const { toast } = useToast();
  const { onOpenFile, activePath } = React.useContext(ExplorerContext);
  const [open, setOpen] = React.useState(false);
  const isDir = entry.kind === "dir";
  const isActive = !isDir && activePath === relPath;

  function run(action: (t: Tokens) => Promise<WithTokens<boolean>>) {
    call(action).catch((err) => toast(errorMessage(err), "error"));
  }

  const row = (
    <button
      type="button"
      onClick={() => (isDir ? setOpen((o) => !o) : onOpenFile(relPath))}
      onDoubleClick={() => !isDir && run((t) => window.photon.openWorkspaceFileExternal(t, workspaceId, relPath))}
      className={`flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-small hover:bg-sidebar-accent ${
        isActive ? "bg-sidebar-accent text-foreground" : ""
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      aria-expanded={isDir ? open : undefined}
      aria-current={isActive ? "true" : undefined}
      title={isDir ? entry.name : `${entry.name}\nClick to view. Double-click to open in the default app.`}
    >
      <CaretRight
        weight="bold"
        className={`size-3 shrink-0 text-slate transition-transform ${isDir ? "" : "invisible"} ${open ? "rotate-90" : ""}`}
      />
      {isDir ? (
        open ? (
          <FolderOpen weight="fill" className="size-4 shrink-0 text-slate" />
        ) : (
          <Folder weight="fill" className="size-4 shrink-0 text-slate" />
        )
      ) : (
        <File weight="bold" className="size-4 shrink-0 text-slate" />
      )}
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
    </button>
  );

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          {!isDir && (
            <>
              <ContextMenuItem onSelect={() => onOpenFile(relPath)}>
                <File weight="bold" />
                View
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => run((t) => window.photon.openWorkspaceFileExternal(t, workspaceId, relPath))}
              >
                <ArrowSquareOut weight="bold" />
                Open in default app
              </ContextMenuItem>
            </>
          )}
          <ContextMenuItem onSelect={() => run((t) => window.photon.revealWorkspaceFile(t, workspaceId, relPath))}>
            <FolderOpen weight="bold" />
            Reveal in Finder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(relPath);
              toast("Path copied");
            }}
          >
            <Copy weight="bold" />
            Copy relative path
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isDir && open && <DirChildren workspaceId={workspaceId} relPath={relPath} depth={depth + 1} />}
    </li>
  );
}

/** Read-only tree of the workspace folder, shown beside a chat that runs in it. */
export function FolderExplorer({
  workspaceId,
  name,
  onCollapse,
}: {
  workspaceId: string;
  name: string;
  onCollapse?: () => void;
}) {
  const { width, setWidth, reset, min, max } = usePanelWidth("photon.explorer.width", EXPLORER_WIDTH);
  // Clicked file, previewed in the lower half of the panel.
  const [preview, setPreview] = React.useState<string | null>(null);
  React.useEffect(() => setPreview(null), [workspaceId]);
  const ctx = React.useMemo(() => ({ onOpenFile: setPreview, activePath: preview }), [preview]);
  return (
    <ExplorerContext.Provider value={ctx}>
      <aside
        className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-sidebar"
        style={{ width, maxWidth: `calc(100% - ${CHAT_MIN_WIDTH}px)` }}
      >
        <ResizeHandle
          edge="left"
          value={width}
          min={min}
          max={max}
          onChange={setWidth}
          onReset={reset}
          label="Resize folder panel"
        />
        <div className="flex h-9 min-w-0 items-center gap-2 pr-1.5 pl-3 text-small font-medium text-foreground">
          <span className="min-w-0 flex-1 truncate" title={name}>
            {name}
          </span>
          {onCollapse && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="shrink-0"
              onClick={onCollapse}
              aria-label="Hide folder panel"
              title="Hide folder panel"
            >
              <SidebarSimple className="rotate-180" />
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3">
          <DirChildren workspaceId={workspaceId} relPath="" depth={0} />
        </div>
        {preview && (
          <div className="flex h-1/2 min-h-0 shrink-0 flex-col border-t border-border bg-background">
            <FileViewer workspaceId={workspaceId} relPath={preview} onClose={() => setPreview(null)} compact />
          </div>
        )}
      </aside>
    </ExplorerContext.Provider>
  );
}
