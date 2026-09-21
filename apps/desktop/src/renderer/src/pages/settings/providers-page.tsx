import * as React from "react";
import { CaretDown, CheckCircle, Copy, MagnifyingGlass, Warning, XCircle } from "@phosphor-icons/react";
import type { LlmProvider, ProviderTestResult } from "../../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";
import { useToast } from "@/hooks/use-toast";
import { cn, errorMessage } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputField, PasswordField } from "@/components/form-fields";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSection } from "@/pages/settings/settings-layout";

const CAPABILITY_LABELS: Record<string, string> = {
  chat: "Chat",
  json_output: "JSON",
  tool_calling: "Tools",
  vision: "Vision",
};

/** One model id as a chip; the default one is marked, missing ones (per a live test) struck through. */
function ModelChip({
  id,
  isDefault,
  missing,
  onCopy,
}: {
  id: string;
  isDefault?: boolean;
  missing?: boolean;
  onCopy: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(id)}
      title={missing ? "Not offered for this key" : "Copy model id"}
      className={cn(
        "group/chip inline-flex h-5.5 max-w-full items-center gap-1 rounded border px-1.5 font-mono text-[11px] leading-none transition-colors",
        missing
          ? "border-dashed border-input text-slate/60 line-through"
          : "border-input bg-sheet text-foreground hover:border-black",
      )}
    >
      <span className="truncate">{id}</span>
      {isDefault && <span className="size-1.5 shrink-0 rounded-full bg-verdigris" title="Default model" aria-label="default" />}
      {!missing && <Copy weight="bold" className="size-2.5 shrink-0 text-slate opacity-0 group-hover/chip:opacity-100" />}
    </button>
  );
}

/** Result line under the key form after a test. */
function TestOutcome({ result, provider }: { result: ProviderTestResult; provider: LlmProvider }) {
  if (!result.ok) {
    return (
      <p className="flex items-start gap-2 text-small text-foreground">
        <XCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-black" />
        <span>
          <span className="font-medium">Key rejected.</span> {result.error}
        </span>
      </p>
    );
  }
  const missingDefault = result.default_model_available === false;
  return (
    <div className="grid gap-1.5 text-small">
      <p className="flex items-center gap-2">
        <CheckCircle weight="fill" className="size-4 shrink-0 text-verdigris" />
        <span>
          <span className="font-medium">Key works.</span> {result.models.length} models, {result.latency_ms} ms.
        </span>
      </p>
      {missingDefault && (
        <p className="flex items-start gap-2 text-slate">
          <Warning weight="fill" className="mt-0.5 size-4 shrink-0" />
          <span>
            The default model <span className="font-mono">{provider.default_model}</span> is not in the list for this
            key. Pick another in General settings.
          </span>
        </p>
      )}
    </div>
  );
}

/** Live model list from a test, filterable. */
function LiveModels({
  models,
  provider,
  onCopy,
}: {
  models: string[];
  provider: LlmProvider;
  onCopy: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
  const seeded = new Set(provider.model_ids);

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-small hover:bg-muted/60"
      >
        <CaretDown weight="bold" className={cn("size-3.5 text-slate transition-transform", !open && "-rotate-90")} />
        <span className="font-medium">Models this key can use</span>
        <span className="text-slate">{models.length}</span>
      </button>
      {open && (
        <div className="border-t border-border p-3">
          <InputField
            name={`${provider.provider}_model_filter`}
            label="Filter models"
            hideLabel
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter"
            spellCheck={false}
            inputClassName="h-8 font-mono text-xs"
          />
          <ul className="mt-3 flex max-h-64 flex-wrap gap-1 overflow-auto">
            {shown.map((m) => (
              <li key={m}>
                <ModelChip id={m} isDefault={m === provider.default_model} onCopy={onCopy} />
              </li>
            ))}
            {!shown.length && (
              <li className="flex items-center gap-2 text-small text-slate">
                <MagnifyingGlass weight="bold" className="size-3.5" />
                Nothing matches.
              </li>
            )}
          </ul>
          <p className="mt-3 text-xs text-slate">
            Chips with a solid border are also in Photon's preset list for {provider.name}
            {seeded.size
              ? ` (${[...seeded].filter((m) => models.includes(m)).length} of ${seeded.size} presets available)`
              : ""}
            .
          </p>
        </div>
      )}
    </div>
  );
}

function ProviderCard({ provider, onChanged }: { provider: LlmProvider; onChanged: () => void }) {
  const { call } = useAuth();
  const { toast } = useToast();
  const [key, setKey] = React.useState("");
  const [busy, setBusy] = React.useState<"save" | "test" | "remove" | null>(null);
  const [result, setResult] = React.useState<ProviderTestResult | null>(null);

  const typed = key.trim();
  const canTest = Boolean(typed || provider.has_key);
  const live = result?.ok ? new Set(result.models) : null;

  function copy(id: string) {
    void navigator.clipboard.writeText(id);
    toast(`Copied ${id}`);
  }

  async function run<T>(what: "save" | "test" | "remove", fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(what);
    try {
      return await fn();
    } catch (err) {
      toast(errorMessage(err), "error");
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    const res = await run("test", () =>
      call((t) => window.photon.testProvider(t, provider.provider, typed || undefined)),
    );
    if (res) setResult(res);
  }

  async function save() {
    if (!typed) return;
    const ok = await run("save", async () => {
      await call((t) => window.photon.setApiKey(t, provider.provider, typed));
      return true;
    });
    if (ok) {
      setKey("");
      setResult(null);
      toast(`${provider.name} key saved`);
      onChanged();
    }
  }

  async function remove() {
    const ok = await run("remove", async () => {
      await call((t) => window.photon.deleteApiKey(t, provider.provider));
      return true;
    });
    if (ok) {
      setResult(null);
      toast(`${provider.name} key removed`);
      onChanged();
    }
  }

  return (
    <article className="rounded-lg border border-border bg-sheet">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lead">{provider.name}</h3>
            {result?.ok ? (
              <Badge variant="granted">
                <CheckCircle weight="fill" />
                verified
              </Badge>
            ) : result && !result.ok ? (
              <Badge variant="failed">
                <XCircle weight="fill" />
                rejected
              </Badge>
            ) : provider.has_key ? (
              <Badge variant="granted">key saved</Badge>
            ) : (
              <Badge variant="outline">no key</Badge>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-slate" title={provider.api_url}>
            {provider.api_url}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {provider.capabilities.map((c) => (
            <Badge key={c} variant="muted">
              {CAPABILITY_LABELS[c] ?? c}
            </Badge>
          ))}
        </div>
      </header>

      <div className="grid gap-4 px-5 py-5">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="flex items-start gap-2">
            <PasswordField
              name={`${provider.provider}_api_key`}
              label={`${provider.name} API key`}
              hideLabel
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (result) setResult(null);
              }}
              placeholder={provider.has_key ? "Paste a new key to replace the saved one" : "Paste the API key"}
              autoComplete="off"
              disabled={busy !== null}
              className="flex-1"
              inputClassName="font-mono text-small"
            />
            <Button type="button" variant="outline" onClick={() => void test()} disabled={!canTest || busy !== null}>
              {busy === "test" ? "Testing" : typed ? "Test this key" : "Test saved key"}
            </Button>
            <Button type="submit" disabled={!typed || busy !== null}>
              {busy === "save" ? "Saving" : "Save key"}
            </Button>
          </div>
          {result && <TestOutcome result={result} provider={provider} />}
        </form>

        <div>
          <p className="mb-2 text-small font-medium">Preset models</p>
          <ul className="flex flex-wrap gap-1">
            {(provider.model_ids.length ? provider.model_ids : [provider.default_model]).map((m) => (
              <li key={m}>
                <ModelChip
                  id={m}
                  isDefault={m === provider.default_model}
                  missing={live ? !live.has(m) : false}
                  onCopy={copy}
                />
              </li>
            ))}
          </ul>
        </div>

        {result?.ok && <LiveModels models={result.models} provider={provider} onCopy={copy} />}

        {provider.has_key && (
          <div className="flex justify-end border-t border-border pt-4">
            <Button type="button" variant="quiet" size="sm" onClick={() => void remove()} disabled={busy !== null}>
              {busy === "remove" ? "Removing" : "Remove saved key"}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

export function ProvidersSettingsPage() {
  const { call, user } = useAuth();
  const providers = useAsync(() => call((t) => window.photon.listProviders(t)), [user?.id]);

  return (
    <SettingsSection
      title="API keys"
      description="One key per provider. The server encrypts each key and only decrypts it in memory for a call. This window never gets a key back. Testing lists the provider's models and spends no tokens."
    >
      {providers.loading ? (
        <div className="grid gap-4">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
      ) : providers.status === "error" ? (
        <p className="text-small text-destructive">{providers.error}</p>
      ) : (
        <div className="grid gap-4">
          {providers.data?.map((p) => (
            <ProviderCard key={p.provider} provider={p} onChanged={providers.reload} />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
