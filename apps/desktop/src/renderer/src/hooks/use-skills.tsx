import * as React from "react";
import type { Skill } from "../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useAsync } from "@/hooks/use-async";

type SkillsContextValue = {
  skills: Skill[];
  loading: boolean;
  error: string | null;
  /** Re-fetch after an install, update or delete. */
  reload: () => void;
};

const SkillsContext = React.createContext<SkillsContextValue | null>(null);

/**
 * The signed-in user's skills, fetched once and shared by the composer (the
 * `/` menu) and the settings page (which edits them and calls `reload`).
 */
export function SkillsProvider({ children }: { children: React.ReactNode }) {
  const { user, call } = useAuth();
  const state = useAsync(() => (user ? call((t) => window.photon.listSkills(t)) : Promise.resolve([])), [user?.id]);
  const value = React.useMemo<SkillsContextValue>(
    () => ({ skills: state.data ?? [], loading: state.loading, error: state.error, reload: state.reload }),
    [state.data, state.loading, state.error, state.reload],
  );
  return <SkillsContext.Provider value={value}>{children}</SkillsContext.Provider>;
}

export function useSkills(): SkillsContextValue {
  const ctx = React.useContext(SkillsContext);
  if (!ctx) throw new Error("useSkills must be used within SkillsProvider");
  return ctx;
}
