import * as React from "react";
import type { ShortcutOverrides } from "../../../preload/api";

import { canonicalAccelerator, isMac, matchesAccelerator } from "@/lib/accelerator";
import { actionById, bindingFor, SHORTCUT_ACTIONS, type ShortcutScope } from "@/lib/keymap";

type KeymapContextValue = {
  overrides: ShortcutOverrides;
  /** The binding in effect for an action. */
  binding: (id: string) => string;
  /** True when `e` is the action's binding. */
  matches: (id: string, e: KeyboardEvent | React.KeyboardEvent) => boolean;
  /** Another action in the same scope already bound to `accelerator`, if any. */
  conflict: (id: string, accelerator: string) => string | null;
  set: (id: string | null, accelerator: string | null) => Promise<void>;
  /** While Settings records a binding, every shortcut in the app stands down. */
  recording: boolean;
  setRecording: (on: boolean) => void;
};

const KeymapContext = React.createContext<KeymapContextValue | null>(null);

/** Loads overrides from main and follows changes made in any window. Mounted once per window. */
export function KeymapProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = React.useState<ShortcutOverrides>({});
  const [recording, setRecording] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void window.photon.getShortcuts().then((next) => live && setOverrides(next));
    const off = window.photon.onShortcutsChanged(setOverrides);
    return () => {
      live = false;
      off();
    };
  }, []);

  const value = React.useMemo<KeymapContextValue>(() => {
    const mac = isMac();
    const binding = (id: string) => bindingFor(id, overrides);
    return {
      overrides,
      binding,
      matches: (id, e) => {
        const keys = binding(id);
        return Boolean(keys) && matchesAccelerator("nativeEvent" in e ? e.nativeEvent : e, keys, mac);
      },
      conflict: (id, accelerator) => {
        const scope = actionById(id)?.scope;
        const target = canonicalAccelerator(accelerator, mac);
        const clash = SHORTCUT_ACTIONS.find(
          (a) => a.id !== id && a.scope === scope && canonicalAccelerator(binding(a.id), mac) === target,
        );
        return clash ? clash.label : null;
      },
      set: async (id, accelerator) => {
        setOverrides(await window.photon.setShortcut(id, accelerator));
      },
      recording,
      setRecording,
    };
  }, [overrides, recording]);

  return <KeymapContext.Provider value={value}>{children}</KeymapContext.Provider>;
}

export function useKeymap(): KeymapContextValue {
  const ctx = React.useContext(KeymapContext);
  if (!ctx) throw new Error("useKeymap must be used within KeymapProvider");
  return ctx;
}

/**
 * Runs `handler` when the action's keys are pressed anywhere in the window.
 * Skipped while typing in a field unless `inFields`, and while Settings is
 * recording a binding.
 */
export function useShortcut(
  id: string,
  handler: (e: KeyboardEvent) => void,
  opts: { enabled?: boolean; inFields?: boolean } = {},
) {
  const { matches, recording } = useKeymap();
  const latest = React.useRef(handler);
  latest.current = handler;
  const { enabled = true, inFields = false } = opts;

  React.useEffect(() => {
    if (!enabled || recording) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing && !inFields) return;
      if (!matches(id, e)) return;
      e.preventDefault();
      latest.current(e);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, enabled, inFields, recording, matches]);
}

export type { ShortcutScope };
