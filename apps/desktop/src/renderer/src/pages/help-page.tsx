import { Page, SectionTitle } from "@/components/layout/page";

const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  { keys: ["⌘", "B"], what: "Hide or show the sidebar" },
  { keys: ["⌘", "Enter"], what: "Send the message in Chat" },
  { keys: ["⌘", "R"], what: "Reload the window" },
];

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
    q: "It says the server is not answering.",
    a: "Start it from the repo root with pnpm server. The app looks for it at http://127.0.0.1:8000 unless PHOTON_API_URL points somewhere else.",
  },
];

export function HelpPage() {
  return (
    <Page title="Shortcuts and answers">
      <div className="grid gap-14">
        <section>
          <SectionTitle className="mb-5">Keyboard</SectionTitle>
          <dl className="max-w-lg">
            {SHORTCUTS.map((s) => (
              <div key={s.what} className="flex items-center justify-between gap-6 py-2.5">
                <dt>{s.what}</dt>
                <dd className="flex gap-1">
                  {s.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
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
