import * as React from "react";

/** A boolean preference kept in localStorage; falls back to `initial` when storage is unavailable. */
export function useStoredFlag(key: string, initial: boolean): [boolean, () => void] {
  const [value, setValue] = React.useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? initial : raw === "true";
    } catch {
      return initial;
    }
  });

  const toggle = React.useCallback(() => {
    setValue((v) => {
      try {
        window.localStorage.setItem(key, String(!v));
      } catch {
        // Preference only; ignore storage failures.
      }
      return !v;
    });
  }, [key]);

  return [value, toggle];
}
