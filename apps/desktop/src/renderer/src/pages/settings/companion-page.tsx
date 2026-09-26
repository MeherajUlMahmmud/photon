import * as React from "react";
import type { CompanionInfo, CompanionSettings } from "../../../../preload/api";

import { useToast } from "@/hooks/use-toast";
import { acceleratorFromKey, acceleratorKeys, isMac } from "@/lib/accelerator";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/form-fields";
import { SettingsSection } from "@/pages/settings/settings-layout";

const DEFAULT_SHORTCUT = "Alt+Space";
const DEFAULT_ANNOTATE_SHORTCUT = "Alt+Shift+Space";

export function Keys({ accelerator }: { accelerator: string }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {acceleratorKeys(accelerator, isMac()).map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}

/** Click, press the new combination; Esc cancels. The live shortcut is released meanwhile so it can be re-picked. */
function ShortcutRecorder({
  active,
  saved,
  fallback,
  error,
  enabled,
  onSave,
  disabled,
}: {
  /** The accelerator registered right now, if any. */
  active: string | null;
  /** The one in settings (shown when none is registered). */
  saved: string;
  /** What Reset goes back to. */
  fallback: string;
  error: string | null;
  enabled: boolean;
  onSave: (accelerator: string) => Promise<void>;
  disabled: boolean;
}) {
  const [recording, setRecording] = React.useState(false);
  const [hint, setHint] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!recording) return;
    void window.photon.suspendCompanionShortcut(true);
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false);
        return;
      }
      const result = acceleratorFromKey(e, isMac());
      if (result.kind === "pending") return;
      if (result.kind === "invalid") {
        setHint(result.reason);
        return;
      }
      setRecording(false);
      void onSave(result.accelerator);
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      void window.photon.suspendCompanionShortcut(false);
    };
  }, [recording, onSave]);

  const current = active ?? saved;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={`flex h-9 min-w-40 items-center rounded-md border px-3 press ${
            recording ? "border-verdigris bg-verdigris-wash" : "border-input bg-sheet"
          }`}
          aria-live="polite"
        >
          {recording ? <span className="text-small text-slate">Press the new shortcut…</span> : <Keys accelerator={current} />}
        </div>
        {recording ? (
          <Button variant="ghost" onClick={() => setRecording(false)}>
            Cancel
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setHint(null);
                setRecording(true);
              }}
            >
              Change
            </Button>
            {current !== fallback && (
              <Button variant="quiet" disabled={disabled} onClick={() => void onSave(fallback)}>
                Reset to <Keys accelerator={fallback} />
              </Button>
            )}
          </>
        )}
      </div>
      {recording && <p className="text-small text-slate">{hint ?? "Hold ⌘, ⌃ or ⌥ and press a key. Esc cancels."}</p>}
      {!recording && error && <p className="text-small text-foreground">{error}</p>}
      {!recording && enabled && !active && !error && (
        <p className="text-small text-slate">No shortcut is active. Pick another one, or use the menu-bar icon.</p>
      )}
    </div>
  );
}

const PERMISSION_TEXT: Record<CompanionInfo["permission"], string> = {
  granted: "Allowed. Photon can take a picture of your screen when you ask.",
  "not-determined": "Not asked yet. macOS asks the first time the companion looks at your screen.",
  denied: "Blocked. Turn on Photon under Privacy & Security, Screen Recording, then quit and reopen Photon.",
  restricted: "Blocked by a device policy on this Mac.",
  unknown: "Photon couldn't read the permission. Try opening the companion once.",
};

export function CompanionSettingsPage() {
  const { toast } = useToast();
  const [info, setInfo] = React.useState<CompanionInfo | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    window.photon
      .companionInfo()
      .then(setInfo)
      .catch((err) => setLoadError(errorMessage(err)));
  }, []);

  React.useEffect(() => {
    refresh();
    // Permission can change in System Settings while this page is open.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const save = React.useCallback(
    async (patch: Partial<CompanionSettings>, done?: string) => {
      setSaving(true);
      try {
        const next = await window.photon.setCompanionSettings(patch);
        setInfo(next);
        if (!next.shortcutError && done) toast(done);
      } catch (err) {
        toast(errorMessage(err), "error");
      } finally {
        setSaving(false);
      }
    },
    [toast],
  );

  const saveShortcut = React.useCallback(
    (accelerator: string) => save({ shortcut: accelerator }, "Shortcut saved"),
    [save],
  );
  const saveAnnotateShortcut = React.useCallback(
    (accelerator: string) => save({ annotateShortcut: accelerator }, "Annotate shortcut saved"),
    [save],
  );

  async function allowAccessibility() {
    try {
      setInfo(await window.photon.requestAccessibility());
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  if (loadError) return <p className="text-slate">Couldn't load companion settings: {loadError}</p>;
  if (!info) return <p className="text-slate">Loading…</p>;

  const { settings } = info;
  const off = !settings.enabled;

  return (
    <>
      <SettingsSection
        title="Companion"
        description="A small window that opens over any app with a shortcut. It can look at your screen and answer questions about what's on it."
      >
        <div className="grid gap-4">
          <CheckboxField
            name="companion_enabled"
            label="Turn on the companion"
            description="Off removes the shortcut and the Ask Photon menu-bar item. Chats in this window are unaffected."
            value={settings.enabled}
            disabled={saving}
            onCheckedChange={(enabled) =>
              void save({ enabled }, enabled ? "Companion is on" : "Companion is off")
            }
          />
          <div>
            <Button variant="outline" disabled={off} onClick={() => void window.photon.showCompanion()}>
              Open the companion
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Shortcut" description="Works from any app, including full-screen ones. Press it again to hide.">
        <ShortcutRecorder
          active={info.shortcut}
          saved={settings.shortcut}
          fallback={DEFAULT_SHORTCUT}
          error={info.shortcutError}
          enabled={settings.enabled}
          onSave={saveShortcut}
          disabled={off || saving}
        />
      </SettingsSection>

      <SettingsSection
        title="Screen"
        description="Screenshots go to your provider with the one message they were taken for. They are never saved; the server logs only that an image was sent."
      >
        <div className="grid gap-5">
          <CheckboxField
            name="companion_capture"
            label="Look at the screen when it opens"
            description="Off: the companion opens without a screenshot, and you click Look at my screen when you want one."
            value={settings.captureOnOpen}
            disabled={off || saving}
            onCheckedChange={(captureOnOpen) => void save({ captureOnOpen })}
          />
          <div className="grid max-w-[60ch] gap-2">
            <p className="text-small font-medium">Screen recording permission</p>
            <p className="text-small text-slate">{PERMISSION_TEXT[info.permission]}</p>
            {info.permission !== "granted" && isMac() && (
              <div>
                <Button size="sm" variant="outline" onClick={() => void window.photon.openScreenPermissionSettings()}>
                  Open Screen Recording settings
                </Button>
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Annotate"
        description="Freeze the screen under a dark tint, draw boxes, arrows and notes on it, then ask the companion or start a chat about it."
      >
        <div className="grid gap-5">
          <div className="grid gap-2">
            <p className="text-small font-medium">Keyboard shortcut</p>
            <ShortcutRecorder
              active={info.annotate.shortcut}
              saved={settings.annotateShortcut}
              fallback={DEFAULT_ANNOTATE_SHORTCUT}
              error={info.annotate.shortcutError}
              enabled={settings.enabled}
              onSave={saveAnnotateShortcut}
              disabled={off || saving}
            />
          </div>
          <CheckboxField
            name="companion_annotate_gesture"
            label="Ctrl + long press with the mouse"
            description="Hold Control and keep the left button down for half a second anywhere. On a Mac, Control-click is also a right click, so the app underneath may open a menu; Esc closes both."
            value={settings.annotateGesture}
            disabled={off || saving}
            onCheckedChange={(annotateGesture) => void save({ annotateGesture })}
          />
          {settings.annotateGesture && isMac() && (
            <div className="grid max-w-[60ch] gap-2">
              <p className="text-small font-medium">Accessibility permission</p>
              <p className="text-small text-slate">
                {info.annotate.accessibility === "granted"
                  ? info.annotate.gestureActive
                    ? "Allowed. Photon is listening for Ctrl + long press."
                    : "Allowed, but the gesture isn't running yet. Quit and reopen Photon."
                  : "Needed to notice a mouse press in other apps. Photon listens only to mouse presses and pointer position; it doesn't read keystrokes."}
              </p>
              {info.annotate.accessibility !== "granted" && (
                <div>
                  <Button size="sm" variant="outline" onClick={() => void allowAccessibility()}>
                    Allow in System Settings
                  </Button>
                </div>
              )}
            </div>
          )}
          <div>
            <Button variant="outline" disabled={off} onClick={() => void window.photon.startAnnotation()}>
              Try it now
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Window">
        <CheckboxField
          name="companion_hide_on_blur"
          label="Hide when I click another app"
          description="Off keeps it floating on top until you press Esc or the shortcut."
          value={settings.hideOnBlur}
          disabled={off || saving}
          onCheckedChange={(hideOnBlur) => void save({ hideOnBlur })}
        />
      </SettingsSection>
    </>
  );
}
