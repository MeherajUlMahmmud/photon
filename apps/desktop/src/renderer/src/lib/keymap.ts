/**
 * Every in-app shortcut, with its default binding. Overrides come from main
 * (Settings > Shortcuts). Scope says where an action listens, and doubles as
 * the conflict boundary: two actions may share keys only in different scopes.
 * The two global shortcuts (companion, annotate) are OS-wide and live in the
 * companion settings instead.
 */

export type ShortcutScope = "app" | "composer" | "companion" | "annotate";

export type ShortcutAction = {
  id: string;
  label: string;
  scope: ShortcutScope;
  /** Electron accelerator syntax, e.g. "CommandOrControl+B" or a bare "P". */
  defaultKeys: string;
  /** Single keys without ⌘/⌃/⌥ are fine here: the surface has no text field focused when it listens. */
  allowBare?: boolean;
};

export const SCOPE_LABELS: Record<ShortcutScope, string> = {
  app: "Photon window",
  composer: "Message box",
  companion: "Companion",
  annotate: "Annotate overlay",
};

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "app.toggle-sidebar", label: "Hide or show the sidebar", scope: "app", defaultKeys: "CommandOrControl+B" },
  { id: "app.new-chat", label: "New chat", scope: "app", defaultKeys: "CommandOrControl+N" },
  { id: "app.open-settings", label: "Open settings", scope: "app", defaultKeys: "CommandOrControl+," },
  { id: "composer.send", label: "Send the message", scope: "composer", defaultKeys: "Enter", allowBare: true },
  { id: "companion.hide", label: "Hide the companion", scope: "companion", defaultKeys: "Escape", allowBare: true },
  { id: "annotate.send", label: "Ask the companion", scope: "annotate", defaultKeys: "Enter", allowBare: true },
  { id: "annotate.cancel", label: "Cancel", scope: "annotate", defaultKeys: "Escape", allowBare: true },
  { id: "annotate.undo", label: "Undo the last mark", scope: "annotate", defaultKeys: "CommandOrControl+Z" },
  { id: "annotate.tool-pen", label: "Pen", scope: "annotate", defaultKeys: "P", allowBare: true },
  { id: "annotate.tool-box", label: "Box", scope: "annotate", defaultKeys: "B", allowBare: true },
  { id: "annotate.tool-arrow", label: "Arrow", scope: "annotate", defaultKeys: "A", allowBare: true },
  { id: "annotate.tool-text", label: "Text label", scope: "annotate", defaultKeys: "T", allowBare: true },
];

export type ShortcutId = (typeof SHORTCUT_ACTIONS)[number]["id"];

const BY_ID = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]));

export function actionById(id: string): ShortcutAction | undefined {
  return BY_ID.get(id);
}

/** The binding in effect: the user's override, else the default. */
export function bindingFor(id: string, overrides: Record<string, string>): string {
  return overrides[id] ?? BY_ID.get(id)?.defaultKeys ?? "";
}
