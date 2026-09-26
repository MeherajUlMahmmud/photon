import * as React from "react";

import { useKeymap } from "@/hooks/use-keymap";
import { acceleratorFromKey, acceleratorKeys, canonicalAccelerator, isMac } from "@/lib/accelerator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** An accelerator as key caps: ⌥ Space on a Mac, Ctrl Shift Space elsewhere. */
export function Keys({ accelerator, className }: { accelerator: string; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {acceleratorKeys(accelerator, isMac()).map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}

/**
 * Click Change, press the new combination; Esc cancels (unless Esc is the
 * binding being recorded, in which case Cancel does). While recording, every
 * shortcut in the app and both global shortcuts stand down so the keys reach
 * the recorder.
 */
export function ShortcutRecorder({
  value,
  fallback,
  error,
  allowBare = false,
  validate,
  onSave,
  disabled,
  compact = false,
}: {
  /** The binding shown now. */
  value: string;
  /** What Reset goes back to. */
  fallback: string;
  error?: string | null;
  allowBare?: boolean;
  /** Returns a sentence when the new binding can't be used (e.g. taken by another action). */
  validate?: (accelerator: string) => string | null;
  onSave: (accelerator: string) => Promise<void> | void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const keymap = useKeymap();
  const [recording, setRecording] = React.useState(false);
  const [hint, setHint] = React.useState<string | null>(null);
  const setAppRecording = keymap.setRecording;

  React.useEffect(() => {
    if (!recording) return;
    setAppRecording(true);
    void window.photon.suspendCompanionShortcut(true);
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      const bareEscape = e.code === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (bareEscape && !allowBare) {
        setRecording(false);
        return;
      }
      const result = acceleratorFromKey(e, isMac(), { allowBare });
      if (result.kind === "pending") return;
      if (result.kind === "invalid") {
        setHint(result.reason);
        return;
      }
      const problem = validate?.(result.accelerator) ?? null;
      if (problem) {
        setHint(problem);
        return;
      }
      setRecording(false);
      void onSave(result.accelerator);
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setAppRecording(false);
      void window.photon.suspendCompanionShortcut(false);
    };
  }, [recording, allowBare, validate, onSave, setAppRecording]);

  const mac = isMac();
  const isDefault = canonicalAccelerator(value, mac) === canonicalAccelerator(fallback, mac);

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div
          className={cn(
            "flex items-center rounded-md border px-2.5 press",
            compact ? "h-8 min-w-28" : "h-9 min-w-40",
            recording ? "border-verdigris bg-verdigris-wash" : "border-input bg-sheet",
          )}
          aria-live="polite"
        >
          {recording ? <span className="text-small text-slate">Press keys…</span> : <Keys accelerator={value} />}
        </div>
        {recording ? (
          <Button size={compact ? "sm" : "default"} variant="ghost" onClick={() => setRecording(false)}>
            Cancel
          </Button>
        ) : (
          <>
            <Button
              size={compact ? "sm" : "default"}
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setHint(null);
                setRecording(true);
              }}
            >
              Change
            </Button>
            {!isDefault && (
              <Button size={compact ? "sm" : "default"} variant="quiet" disabled={disabled} onClick={() => void onSave(fallback)}>
                Reset
              </Button>
            )}
          </>
        )}
      </div>
      {recording && (
        <p className="text-small text-slate">
          {hint ?? (allowBare ? "Press a key or a combination. Click Cancel to stop." : "Hold ⌘, ⌃ or ⌥ and press a key. Esc cancels.")}
        </p>
      )}
      {!recording && error && <p className="text-small text-foreground">{error}</p>}
    </div>
  );
}
