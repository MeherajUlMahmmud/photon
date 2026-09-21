import * as React from "react";
import type { DictationEngine, LocalDictationProgress, LocalDictationStatus } from "../../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";
import { DICTATION_ENGINE_KEY } from "@/hooks/use-dictation";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectOption } from "@/components/form-fields";
import { SettingsSection } from "@/pages/settings/settings-layout";

const ENGINES: SelectOption[] = [
  { value: "local", label: "On this device" },
  { value: "cloud", label: "Through your provider" },
];

const ENGINE_NOTES: Record<DictationEngine, string> = {
  local:
    "Whisper runs here. The first use downloads an 80 MB model; after that it works offline and audio never leaves the machine.",
  cloud: "Audio goes to a provider that does speech to text (OpenAI today) with your own key. Faster on slow machines.",
};

function progressText(p: LocalDictationProgress | null): string | null {
  if (!p || p.stage === "ready") return null;
  return `${p.stage === "downloading" ? "Downloading" : "Loading"} ${p.file}, ${Math.round(p.percent)}%`;
}

/** Picks the dictation engine and manages the on-device model. */
export function DictationSection() {
  const { call, user } = useAuth();
  const { toast } = useToast();
  const saved = useAsync(() => call((t) => window.photon.getSetting(t, DICTATION_ENGINE_KEY)), [user?.id]);
  const [engine, setEngine] = React.useState<DictationEngine>("local");
  const [model, setModel] = React.useState<LocalDictationStatus | null>(null);
  const [progress, setProgress] = React.useState<LocalDictationProgress | null>(null);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    if (saved.status === "success") setEngine(saved.data === "cloud" ? "cloud" : "local");
  }, [saved.status, saved.data]);

  const refreshModel = React.useCallback(() => {
    void window.photon.localDictationStatus().then(setModel);
  }, []);

  React.useEffect(refreshModel, [refreshModel]);
  React.useEffect(() => window.photon.onLocalDictationProgress(setProgress), []);

  async function pick(next: DictationEngine) {
    setEngine(next);
    await call((t) => window.photon.setSetting(t, DICTATION_ENGINE_KEY, next));
    toast(next === "local" ? "Dictation now runs on this device" : "Dictation now goes through your provider");
  }

  async function download() {
    setWorking(true);
    try {
      setModel(await window.photon.prepareLocalDictation());
      toast("Speech model ready");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setWorking(false);
      setProgress(null);
    }
  }

  async function remove() {
    setWorking(true);
    try {
      await window.photon.removeLocalDictationModel();
      refreshModel();
      toast("Speech model removed");
    } finally {
      setWorking(false);
    }
  }

  const live = progressText(progress);

  return (
    <SettingsSection title="Dictation" description="How the microphone button in a chat turns speech into text.">
      <div className="grid max-w-lg gap-4">
        <SelectField
          name="dictation_engine"
          label="Engine"
          options={ENGINES}
          value={engine}
          onValueChange={(v) => void pick(v as DictationEngine)}
          description={ENGINE_NOTES[engine]}
        />
        {engine === "local" && (
          <div className="flex flex-wrap items-center gap-3 text-small text-slate">
            <span>
              {live ??
                (model === null
                  ? "Checking the speech model"
                  : model.downloaded
                    ? "Speech model downloaded."
                    : "Speech model not downloaded yet.")}
            </span>
            {model && !model.downloaded && (
              <Button variant="outline" size="sm" onClick={() => void download()} disabled={working}>
                Download now
              </Button>
            )}
            {model?.downloaded && (
              <Button variant="quiet" size="sm" onClick={() => void remove()} disabled={working}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
