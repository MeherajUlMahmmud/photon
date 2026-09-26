import * as React from "react";
import type { AuthUser, RegisterInput, Tokens, WithTokens } from "../../../preload/api";

import { loadTokens, saveTokens, TOKEN_KEY } from "@/lib/tokens";
import { errorMessage } from "@/lib/utils";

type AuthStatus = "booting" | "offline" | "anonymous" | "authenticated";

type AuthContextValue = {
  status: AuthStatus;
  bootError: string | null;
  user: AuthUser | null;
  tokens: Tokens | null;
  hasUsers: boolean;
  info: { name: string; version: string } | null;
  retry: () => Promise<void>;
  login: (email: string, password: string) => Promise<string | null>;
  register: (input: RegisterInput) => Promise<string | null>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => void;
  /**
   * Runs an authenticated IPC call with the current token pair and persists a
   * rotated pair when main refreshed it. Every page should call the API through
   * this so token rotation stays in one place.
   */
  call: <T>(fn: (tokens: Tokens) => Promise<WithTokens<T>>) => Promise<T>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>("booting");
  const [bootError, setBootError] = React.useState<string | null>(null);
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [hasUsers, setHasUsers] = React.useState(false);
  const [info, setInfo] = React.useState<{ name: string; version: string } | null>(null);
  // Tokens live in a ref as well as state so `call` always sees the latest pair,
  // even when several requests are in flight during a rotation.
  const tokensRef = React.useRef<Tokens | null>(null);
  const [tokens, setTokensState] = React.useState<Tokens | null>(null);

  const setTokens = React.useCallback((next: Tokens | null) => {
    tokensRef.current = next;
    saveTokens(next);
    setTokensState(next);
  }, []);

  const call = React.useCallback(
    async <T,>(fn: (tokens: Tokens) => Promise<WithTokens<T>>): Promise<T> => {
      const current = tokensRef.current;
      if (!current) throw new Error("Not signed in");
      const result = await fn(current);
      if (result.tokens) setTokens(result.tokens);
      return result.data;
    },
    [setTokens],
  );

  const boot = React.useCallback(async () => {
    setStatus("booting");
    setBootError(null);
    try {
      setInfo(await window.photon.getInfo());
      setHasUsers(await window.photon.hasUsers());

      const saved = loadTokens();
      if (saved) {
        tokensRef.current = saved;
        const me = await call((t) => window.photon.me(t));
        if (me) {
          setTokensState(saved);
          setUser(me);
          setStatus("authenticated");
          return;
        }
        setTokens(null);
      }
      setStatus("anonymous");
    } catch (err) {
      setBootError(errorMessage(err));
      setStatus("offline");
    }
  }, [call, setTokens]);

  React.useEffect(() => {
    void boot();
  }, [boot]);

  // The main window and the companion share one token pair through storage.
  // A `storage` event means the other window rotated, signed in or signed out.
  React.useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== TOKEN_KEY) return;
      const next = loadTokens();
      const wasSignedIn = tokensRef.current !== null;
      tokensRef.current = next;
      setTokensState(next);
      if (!next) {
        setUser(null);
        setStatus("anonymous");
      } else if (!wasSignedIn) {
        void boot();
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [boot]);

  const login = React.useCallback(
    async (email: string, password: string) => {
      const result = await window.photon.login(email, password);
      if (!result.ok) return result.error;
      setTokens(result.tokens);
      setUser(result.user);
      setHasUsers(true);
      setStatus("authenticated");
      return null;
    },
    [setTokens],
  );

  const register = React.useCallback(
    async (input: RegisterInput) => {
      const result = await window.photon.register(input);
      if (!result.ok) return result.error;
      setTokens(result.tokens);
      setUser(result.user);
      setHasUsers(true);
      setStatus("authenticated");
      return null;
    },
    [setTokens],
  );

  const logout = React.useCallback(async () => {
    const current = tokensRef.current;
    setTokens(null);
    setUser(null);
    setStatus("anonymous");
    if (current) await window.photon.logout(current);
    setHasUsers(await window.photon.hasUsers().catch(() => true));
  }, [setTokens]);

  const value = React.useMemo<AuthContextValue>(
    () => ({ status, bootError, user, tokens, hasUsers, info, retry: boot, login, register, logout, setUser, call }),
    [status, bootError, user, tokens, hasUsers, info, boot, login, register, logout, call],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
