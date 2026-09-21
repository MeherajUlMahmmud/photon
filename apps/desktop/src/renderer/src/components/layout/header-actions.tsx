import * as React from "react";
import { createPortal } from "react-dom";

const HeaderActionsContext = React.createContext<HTMLElement | null>(null);

/** Wraps the shell; `HeaderActionsSlot` marks where pages' header actions land. */
export function HeaderActionsProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<HTMLElement | null>(null);
  return (
    <HeaderActionsContext.Provider value={target}>
      <TargetSetter.Provider value={setTarget}>{children}</TargetSetter.Provider>
    </HeaderActionsContext.Provider>
  );
}

const TargetSetter = React.createContext<(el: HTMLElement | null) => void>(() => {});

/** The right-hand end of the shell header. Rendered once, by the shell. */
export function HeaderActionsSlot({ className }: { className?: string }) {
  const setTarget = React.useContext(TargetSetter);
  return <div ref={setTarget} className={className} />;
}

/** Puts `children` in the shell header for as long as the caller is mounted. */
export function HeaderActions({ children }: { children: React.ReactNode }) {
  const target = React.useContext(HeaderActionsContext);
  if (!target) return null;
  return createPortal(children, target);
}
