/**
 * Electron accelerator strings for the companion shortcut: built from a key
 * press when recording one, and shown with platform symbols.
 */

type KeyPress = Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

const NAMED_CODES: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

/** The key part of an accelerator, from the physical key (`code`), so Option on a Mac can't turn "K" into "˚". */
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return NAMED_CODES[code] ?? null;
}

export type Recorded =
  | { kind: "accelerator"; accelerator: string }
  /** Only modifiers so far: keep listening. */
  | { kind: "pending" }
  | { kind: "invalid"; reason: string };

/**
 * Turns a key press into an accelerator. A shortcut needs at least one
 * modifier (function keys excepted), or typing that key anywhere would
 * open the companion.
 */
export function acceleratorFromKey(e: KeyPress, mac: boolean): Recorded {
  const key = keyName(e.code);
  if (!key) {
    return /^(Meta|Control|Alt|Shift)(Left|Right)$/.test(e.code)
      ? { kind: "pending" }
      : { kind: "invalid", reason: "That key can't be used in a shortcut." };
  }
  const mods: string[] = [];
  if (e.metaKey) mods.push(mac ? "Command" : "Super");
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const bare = mods.length === 0 || (mods.length === 1 && mods[0] === "Shift");
  if (bare && !/^F\d+$/.test(key)) {
    return { kind: "invalid", reason: "Add ⌘, ⌃ or ⌥ so normal typing doesn't trigger it." };
  }
  return { kind: "accelerator", accelerator: [...mods, key].join("+") };
}

const MAC_SYMBOLS: Record<string, string> = {
  Command: "⌘",
  Cmd: "⌘",
  CommandOrControl: "⌘",
  CmdOrCtrl: "⌘",
  Control: "⌃",
  Ctrl: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
};

/** Keys to show for an accelerator, e.g. ["⌥", "Space"] on a Mac or ["Ctrl", "Shift", "Space"] elsewhere. */
export function acceleratorKeys(accelerator: string, mac: boolean): string[] {
  return accelerator.split("+").map((part) => {
    if (mac) return MAC_SYMBOLS[part] ?? part;
    if (part === "CommandOrControl" || part === "CmdOrCtrl" || part === "Control") return "Ctrl";
    if (part === "Super") return "Win";
    return part;
  });
}

export const isMac = () => typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
