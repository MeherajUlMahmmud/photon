import * as React from "react";

export type PanelWidthOptions = { fallback: number; min: number; max: number };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readStored(key: string, { fallback, min, max }: PanelWidthOptions): number {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? clamp(n, min, max) : fallback;
  } catch {
    return fallback;
  }
}

/** A panel width in px, clamped to [min, max] and remembered per viewer in localStorage. */
export function usePanelWidth(key: string, options: PanelWidthOptions) {
  const { fallback, min, max } = options;
  const [width, setWidthState] = React.useState(() => readStored(key, options));

  const setWidth = React.useCallback(
    (next: number) => {
      const value = Math.round(clamp(next, min, max));
      setWidthState(value);
      try {
        window.localStorage.setItem(key, String(value));
      } catch {
        // Preference just won't persist.
      }
    },
    [key, min, max],
  );

  const reset = React.useCallback(() => setWidth(fallback), [setWidth, fallback]);

  return { width, setWidth, reset, min, max } as const;
}
