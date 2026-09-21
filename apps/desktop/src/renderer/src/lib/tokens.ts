import type { Tokens } from "../../../preload/api";

const TOKEN_KEY = "photon.auth.tokens";

export function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Tokens>) : null;
    return parsed?.access && parsed?.refresh ? { access: parsed.access, refresh: parsed.refresh } : null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: Tokens | null): void {
  try {
    if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable; the session then lasts until reload.
  }
}
