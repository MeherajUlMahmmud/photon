import * as React from "react";
import type { LlmProvider } from "../../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection } from "@/pages/settings/settings-layout";

function ProviderRow({ provider, onChanged }: { provider: LlmProvider; onChanged: () => void }) {
  const { call } = useAuth();
  const { toast } = useToast();
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!key.trim()) return;
    setBusy(true);
    try {
      await call((t) => window.photon.setApiKey(t, provider.provider, key.trim()));
      setKey("");
      toast(`${provider.name} key saved`);
      onChanged();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await call((t) => window.photon.deleteApiKey(t, provider.provider));
      toast(`${provider.name} key removed`);
      onChanged();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 py-6 not-last:border-b not-last:border-border md:grid-cols-[12rem_1fr]">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{provider.name}</span>
          {provider.has_key && <Badge variant="granted">key saved</Badge>}
        </div>
        <p className="mt-1 font-mono text-small text-slate">{provider.default_model}</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={provider.has_key ? "Paste a new key to replace the saved one" : "Paste the API key"}
          autoComplete="off"
          spellCheck={false}
          className="bg-sheet font-mono text-small"
          disabled={busy}
          aria-label={`${provider.name} API key`}
        />
        <Button type="submit" disabled={!key.trim() || busy}>
          Save key
        </Button>
        {provider.has_key && (
          <Button type="button" variant="ghost" onClick={() => void remove()} disabled={busy}>
            Remove
          </Button>
        )}
      </form>
    </div>
  );
}

export function ProvidersSettingsPage() {
  const { call, user } = useAuth();
  const providers = useAsync(() => call((t) => window.photon.listProviders(t)), [user?.id]);

  return (
    <SettingsSection
      title="API keys"
      description="One key per provider. The server encrypts each key and only decrypts it in memory for a call. This window never gets a key back."
    >
      {providers.loading ? (
        <div className="grid gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : providers.status === "error" ? (
        <p>{providers.error}</p>
      ) : (
        <div className="-mt-6">
          {providers.data?.map((p) => (
            <ProviderRow key={p.provider} provider={p} onChanged={providers.reload} />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
