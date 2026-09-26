import * as React from "react";
import { FileText, Paperclip, X } from "@phosphor-icons/react";

import { fileToAttachment, formatBytes, imageUrl, MAX_IMAGES, type Attachment } from "@/lib/attachments";
import { Button } from "@/components/ui/button";

/** Chips for what goes with the next message; each one can be taken off. */
export function AttachmentTray({ items, onRemove }: { items: Attachment[]; onRemove: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="Attachments">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex max-w-full min-w-0 animate-reveal items-center gap-2 rounded-md border border-input bg-sheet py-1 pr-1 pl-1 shadow-ambient"
        >
          {a.kind === "image" ? (
            <img src={imageUrl(a.image)} alt="" className="h-7 w-auto max-w-16 shrink-0 rounded-sm border border-border object-cover" />
          ) : (
            <FileText weight="bold" className="ml-1 size-4 shrink-0 text-slate" />
          )}
          <span className="min-w-0 truncate text-small">{a.name}</span>
          {a.kind === "text" && <span className="shrink-0 font-mono text-micro text-slate">{formatBytes(a.size)}</span>}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-6 shrink-0"
            onClick={() => onRemove(a.id)}
            aria-label={`Remove ${a.name}`}
            title="Remove"
          >
            <X className="size-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Attachment state for a composer: add from files (picker, drop, paste),
 * enforce the image cap, report problems through `onError`.
 */
export function useAttachments(onError: (message: string) => void) {
  const [items, setItems] = React.useState<Attachment[]>([]);
  const latest = React.useRef(onError);
  latest.current = onError;

  const add = React.useCallback((next: Attachment[]) => {
    setItems((prev) => {
      const merged = [...prev];
      for (const a of next) {
        if (a.kind === "image" && merged.filter((m) => m.kind === "image").length >= MAX_IMAGES) {
          latest.current(`Up to ${MAX_IMAGES} images per message.`);
          continue;
        }
        merged.push(a);
      }
      return merged;
    });
  }, []);

  const addFiles = React.useCallback(
    async (files: Iterable<File>) => {
      const ready: Attachment[] = [];
      for (const file of files) {
        try {
          ready.push(await fileToAttachment(file));
        } catch (err) {
          latest.current(err instanceof Error ? err.message : String(err));
        }
      }
      if (ready.length) add(ready);
    },
    [add],
  );

  const remove = React.useCallback((id: string) => setItems((prev) => prev.filter((a) => a.id !== id)), []);
  const clear = React.useCallback(() => setItems([]), []);

  /** Paste handler for a textarea's container: images and files on the clipboard become attachments. */
  const onPaste = React.useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files);
      if (!files.length) return;
      e.preventDefault();
      void addFiles(files);
    },
    [addFiles],
  );

  return { items, add, addFiles, remove, clear, onPaste };
}

/** Paperclip button with its hidden file input. */
export function AttachButton({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => ref.current?.click()}
        disabled={disabled}
        aria-label="Attach files"
        title="Attach images or text files"
      >
        <Paperclip />
      </Button>
    </>
  );
}

/** Wraps an area so files dropped anywhere on it are attached; shows a quiet outline while dragging. */
export function DropZone({
  onFiles,
  children,
  className,
}: {
  onFiles: (files: File[]) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [over, setOver] = React.useState(false);
  const depth = React.useRef(0);
  return (
    <div
      className={className}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none fixed inset-2 z-40 grid animate-reveal place-items-center rounded-lg border-2 border-dashed border-verdigris bg-verdigris-wash/70">
          <p className="font-display text-section">Drop to attach</p>
        </div>
      )}
    </div>
  );
}
