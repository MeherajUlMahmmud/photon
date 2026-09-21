import { Link } from "react-router-dom";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";
import { useToast } from "@/hooks/use-toast";
import { Fact, Facts, Page } from "@/components/layout/page";
import { PathBlock } from "@/components/layout/path-block";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function WorkspacePage() {
  const { call, user } = useAuth();
  const { toast } = useToast();

  const workspace = useAsync(() => call((t) => window.photon.getActiveWorkspace(t)), [user?.id]);
  const providers = useAsync(() => call((t) => window.photon.listProviders(t)), [user?.id]);
  const model = useAsync(() => call((t) => window.photon.getSetting(t, "model_id")), [user?.id]);

  const ready = providers.data?.filter((p) => p.has_key) ?? [];
  const missing = providers.data?.filter((p) => !p.has_key) ?? [];

  async function changeFolder() {
    const ws = await call((t) => window.photon.openWorkspace(t));
    if (ws) {
      toast(`Now working in ${ws.name}`);
      workspace.reload();
    }
  }

  const ws = workspace.data;

  return (
    <Page
      title={workspace.loading ? "Loading your workspace" : ws ? `Working in ${ws.name}` : "Choose a folder to work in"}
      lede={
        ws
          ? "Photon reads and writes inside this folder and nowhere else. Anything outside it needs a separate grant."
          : "Photon can read and write inside one folder you pick. It stays out of everything else."
      }
    >
      {workspace.loading ? (
        <Skeleton className="h-28 w-full rounded-lg" />
      ) : (
        <PathBlock
          path={ws?.root_path ?? null}
          note={
            ws
              ? ready.length
                ? `Read and write. ${ready.length === 1 ? "One key" : `${ready.length} keys`} ready.`
                : "Read and write. No API key yet, so runs cannot start."
              : "Pick a folder and Photon gets read and write access to it."
          }
        >
          <Button variant={ws ? "outline" : "granted"} className={ws ? "border-sheet/30 bg-transparent text-sheet hover:border-sheet" : ""} onClick={() => void changeFolder()}>
            {ws ? "Change folder" : "Choose folder"}
          </Button>
        </PathBlock>
      )}

      <Facts className="mt-12">
        <Fact term="Keys">
          {providers.loading ? (
            <Skeleton className="h-5 w-48" />
          ) : ready.length ? (
            <>
              {listNames(ready.map((p) => p.name))} ready.
              {missing.length > 0 && <span className="text-slate"> {listNames(missing.map((p) => p.name))} have no key.</span>}{" "}
              <Link to="/settings/providers" className="underline decoration-input underline-offset-4 hover:decoration-black">
                Manage keys
              </Link>
            </>
          ) : (
            <>
              None saved yet.{" "}
              <Link to="/settings/providers" className="underline decoration-input underline-offset-4 hover:decoration-black">
                Add a key
              </Link>{" "}
              before the first run.
            </>
          )}
        </Fact>
        <Fact term="Model">
          <code>{model.data ?? "claude-sonnet-5"}</code>
        </Fact>
        <Fact term="Tools">
          <code>bash</code>, <code>ls</code>, <code>cs</code>. Every <code>bash</code> command shows up for approval before it runs.
        </Fact>
        <Fact term="Runs">
          Not wired yet. <Link to="/chat" className="underline decoration-input underline-offset-4 hover:decoration-black">Chat</Link> gives plain
          completions meanwhile.
        </Fact>
      </Facts>
    </Page>
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
