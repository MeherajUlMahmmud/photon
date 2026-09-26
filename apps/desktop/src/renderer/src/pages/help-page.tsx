import * as React from "react";

import { Link } from "react-router-dom";

import { useKeymap } from "@/hooks/use-keymap";
import { SHORTCUT_ACTIONS } from "@/lib/keymap";
import { Keys } from "@/components/shortcut-recorder";
import { Page, SectionTitle } from "@/components/layout/page";

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Where do my API keys go?",
    a: "To the Photon server, which encrypts each one before saving it. A key is decrypted in memory only for the moment a request needs it, and is never sent back to this window.",
  },
  {
    q: "What can Photon touch on my disk?",
    a: "Only the folder shown on the Workspace page. Paths outside it are refused until you add another folder yourself.",
  },
  {
    q: "Which provider answers in Chat?",
    a: "The one picked at the top of the page. If that request fails, the server tries the next provider you have a key for, unless you also picked a specific model, in which case it stops.",
  },
  {
    q: "What does the companion see?",
    a: "One picture of the screen under your pointer, taken the moment you press its shortcut. It goes to your provider with your next message only and is never saved; the server logs just that an image was sent. The first time, macOS asks to allow Screen Recording for Photon; quit and reopen Photon after allowing it. Change the shortcut or turn this off in Settings, Companion.",
  },
  {
    q: "How do I point at something on screen?",
    a: "Hold Control and keep the left mouse button down for half a second, or press Option Shift Space. The screen freezes under a dark tint; draw boxes, arrows or notes on it, then ask the companion or start a chat. The mouse gesture needs Accessibility permission on a Mac (Settings, Companion).",
  },
  {
    q: "It says the server is not answering.",
    a: "Start it from the repo root with pnpm server. The app looks for it at http://127.0.0.1:8080 unless PHOTON_API_URL points somewhere else.",
  },
];

export function HelpPage() {
  // Every binding is rebindable, so the list is read live: global ones from main, the rest from the keymap.
  const keymap = useKeymap();
  const [global, setGlobal] = React.useState<Array<{ keys: string; what: string }>>([]);
  React.useEffect(() => {
    void window.photon.companionInfo().then((info) =>
      setGlobal(
        [
          { keys: info.shortcut ?? "", what: "Ask the companion, from any app" },
          { keys: info.annotate.shortcut ?? "", what: "Annotate the screen, from any app" },
        ].filter((s) => s.keys),
      ),
    );
  }, []);
  const shortcuts = [
    ...global,
    ...SHORTCUT_ACTIONS.filter((a) => a.scope === "app" || a.scope === "composer").map((a) => ({
      keys: keymap.binding(a.id),
      what: a.label,
    })),
    { keys: "CommandOrControl+R", what: "Reload the window" },
  ];

  return (
    <Page title="Shortcuts and answers">
      <div className="grid gap-14">
        <section>
          <SectionTitle className="mb-2">Keyboard</SectionTitle>
          <p className="mb-5 text-small text-slate">
            Change any of these, and the companion and annotate keys, in{" "}
            <Link to="/settings/shortcuts" className="underline decoration-input underline-offset-4 hover:decoration-black">
              Settings, Shortcuts
            </Link>
            .
          </p>
          <dl className="max-w-lg">
            {shortcuts.map((s) => (
              <div key={s.what} className="flex items-center justify-between gap-6 py-2.5">
                <dt>{s.what}</dt>
                <dd className="shrink-0">
                  <Keys accelerator={s.keys} />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <SectionTitle className="mb-5">Questions</SectionTitle>
          <div className="max-w-[60ch]">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-3">
                <summary className="flex cursor-pointer list-none items-baseline gap-3 text-lead [&::-webkit-details-marker]:hidden">
                  <span className="w-3 shrink-0 font-mono text-slate group-open:hidden">+</span>
                  <span className="hidden w-3 shrink-0 font-mono text-slate group-open:inline">−</span>
                  {f.q}
                </summary>
                <p className="mt-2 ml-6 text-body text-slate">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </Page>
  );
}
