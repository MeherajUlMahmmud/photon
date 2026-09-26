import * as React from "react";
import { Link } from "react-router-dom";
import type { CompanionInfo, CompanionSettings } from "../../../../preload/api";

import { useKeymap } from "@/hooks/use-keymap";
import { useToast } from "@/hooks/use-toast";
import { SCOPE_LABELS, SHORTCUT_ACTIONS, type ShortcutScope } from "@/lib/keymap";
import { errorMessage } from "@/lib/utils";
import { ShortcutRecorder } from "@/components/shortcut-recorder";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { SettingsSection } from "@/pages/settings/settings-layout";

const DEFAULT_COMPANION = "Alt+Space";
const DEFAULT_ANNOTATE = "Alt+Shift+Space";

const SCOPE_NOTES: Record<ShortcutScope, string> = {
  app: "Work anywhere in the main window, including while typing.",
  composer: "While the message box has focus. Any other Enter still makes a new line.",
  companion: "While the companion window has focus.",
  annotate: "While the annotate overlay is open. Single keys work here because nothing is being typed.",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2 py-2.5">
      <p className="min-w-0 pt-1.5">{label}</p>
      {children}
    </div>
  );
}

/** The two OS-wide shortcuts, stored with the companion settings in main. */
function GlobalShortcuts({ info, onChange }: { info: CompanionInfo; onChange: (next: CompanionInfo) => void }) {
  const { toast } = useToast();
  const { settings } = info;

  async function save(patch: Partial<CompanionSettings>) {
    try {
      const next = await window.photon.setCompanionSettings(patch);
      onChange(next);
      if (!next.shortcutError && !next.annotate.shortcutError) toast("Shortcut saved");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <SettingsSection
      title="Anywhere on your computer"
      description="Global shortcuts work from any app. If another app already uses a combination, Photon keeps the old one and says so."
    >
      {!settings.enabled && (
        <p className="mb-3 text-small text-slate">
          The companion is off, so these do nothing right now. Turn it on in{" "}
          <Link to="/settings/companion" className="underline decoration-input underline-offset-4 hover:decoration-black">
            Companion
          </Link>
          .
        </p>
      )}
      <div className="divide-y divide-border">
        <Row label="Ask the companion">
          <ShortcutRecorder
            compact
            value={info.shortcut ?? settings.shortcut}
            fallback={DEFAULT_COMPANION}
            error={info.shortcutError}
            validate={(a) => (a === (info.annotate.shortcut ?? settings.annotateShortcut) ? "Already used by Annotate the screen." : null)}
            onSave={(shortcut) => save({ shortcut })}
            disabled={!settings.enabled}
          />
        </Row>
        <Row label="Annotate the screen">
          <ShortcutRecorder
            compact
            value={info.annotate.shortcut ?? settings.annotateShortcut}
            fallback={DEFAULT_ANNOTATE}
            error={info.annotate.shortcutError}
            validate={(a) => (a === (info.shortcut ?? settings.shortcut) ? "Already used by Ask the companion." : null)}
            onSave={(annotateShortcut) => save({ annotateShortcut })}
            disabled={!settings.enabled}
          />
        </Row>
      </div>
    </SettingsSection>
  );
}

export function ShortcutsSettingsPage() {
  const keymap = useKeymap();
  const { toast } = useToast();
  const [info, setInfo] = React.useState<CompanionInfo | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);

  React.useEffect(() => {
    window.photon
      .companionInfo()
      .then(setInfo)
      .catch((err) => setLoadError(errorMessage(err)));
  }, []);

  async function saveAction(id: string, accelerator: string) {
    try {
      await keymap.set(id, accelerator);
      toast("Shortcut saved");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function resetAll() {
    try {
      await keymap.set(null, null);
      if (info) setInfo(await window.photon.setCompanionSettings({ shortcut: DEFAULT_COMPANION, annotateShortcut: DEFAULT_ANNOTATE }));
      toast("Every shortcut is back to its default");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const scopes = Object.keys(SCOPE_LABELS) as ShortcutScope[];
  const customised = Object.keys(keymap.overrides).length > 0;

  return (
    <>
      {info ? (
        <GlobalShortcuts info={info} onChange={setInfo} />
      ) : (
        <SettingsSection title="Anywhere on your computer">
          <p className="text-small text-slate">{loadError ? `Couldn't load: ${loadError}` : "Loading…"}</p>
        </SettingsSection>
      )}

      {scopes.map((scope) => (
        <SettingsSection key={scope} title={SCOPE_LABELS[scope]} description={SCOPE_NOTES[scope]}>
          <div className="divide-y divide-border">
            {SHORTCUT_ACTIONS.filter((a) => a.scope === scope).map((action) => (
              <Row key={action.id} label={action.label}>
                <ShortcutRecorder
                  compact
                  value={keymap.binding(action.id)}
                  fallback={action.defaultKeys}
                  allowBare={action.allowBare}
                  validate={(a) => {
                    const clash = keymap.conflict(action.id, a);
                    return clash ? `Already used by ${clash}.` : null;
                  }}
                  onSave={(a) => saveAction(action.id, a)}
                />
              </Row>
            ))}
          </div>
        </SettingsSection>
      ))}

      <SettingsSection title="Start over" description="Put every shortcut, global ones included, back to how Photon ships.">
        <Button variant="outline" onClick={() => setConfirmReset(true)} disabled={!customised && !info}>
          Reset all shortcuts
        </Button>
        <ConfirmDialog
          open={confirmReset}
          onOpenChange={setConfirmReset}
          title="Reset all shortcuts?"
          description="Every custom binding goes back to its default."
          confirmLabel="Reset"
          onConfirm={() => void resetAll()}
        />
      </SettingsSection>
    </>
  );
}
