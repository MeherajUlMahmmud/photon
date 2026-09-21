import * as React from "react";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsSection } from "@/pages/settings/settings-layout";

const DEFAULT_MODEL = "claude-sonnet-5";
const CUSTOM = "__custom";

export function GeneralSettingsPage() {
  const { call, user } = useAuth();
  const { toast } = useToast();
  const providers = useAsync(() => call((t) => window.photon.listProviders(t)), [user?.id]);
  const saved = useAsync(() => call((t) => window.photon.getSetting(t, "model_id")), [user?.id]);
  const [model, setModel] = React.useState<string>("");
  const [custom, setCustom] = React.useState("");

  React.useEffect(() => {
    if (saved.status === "success") setModel(saved.data ?? DEFAULT_MODEL);
  }, [saved.status, saved.data]);

  const known = providers.data?.flatMap((p) => p.model_ids) ?? [];
  const value = known.includes(model) ? model : custom || model ? CUSTOM : "";

  async function save() {
    const next = value === CUSTOM ? custom.trim() || model : model;
    if (!next) return;
    await call((t) => window.photon.setSetting(t, "model_id", next));
    setModel(next);
    toast(`Default model is now ${next}`);
  }

  return (
    <SettingsSection
      title="Default model"
      description="Used when a run does not name one. Photon sends the request to whichever provider offers this model and has a key."
    >
      <form
        className="grid max-w-md gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-2">
          <Label>Model</Label>
          <Select
            value={value}
            onValueChange={(v) => {
              if (v === CUSTOM) {
                setCustom(known.includes(model) ? "" : model);
                setModel("");
              } else {
                setModel(v);
                setCustom("");
              }
            }}
          >
            <SelectTrigger className="w-full font-mono text-small">
              <SelectValue placeholder="Pick a model" />
            </SelectTrigger>
            <SelectContent>
              {providers.data?.map((p) => (
                <SelectGroup key={p.provider}>
                  <SelectLabel>{p.name}</SelectLabel>
                  {p.model_ids.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono text-small">
                      {m}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
              <SelectGroup>
                <SelectLabel>Anything else</SelectLabel>
                <SelectItem value={CUSTOM}>Type a model id</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {value === CUSTOM && (
          <div className="grid gap-2">
            <Label htmlFor="custom-model">Model id</Label>
            <Input
              id="custom-model"
              className="font-mono text-small"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="exactly as the provider names it"
              spellCheck={false}
            />
          </div>
        )}
        <div>
          <Button type="submit">Save default model</Button>
        </div>
      </form>
    </SettingsSection>
  );
}
