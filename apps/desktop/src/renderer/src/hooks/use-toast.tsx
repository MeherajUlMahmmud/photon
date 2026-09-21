import * as React from "react";

type Toast = { id: number; message: string; tone: "default" | "error" };

type ToastContextValue = {
  toast: (message: string, tone?: Toast["tone"]) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(1);

  const toast = React.useCallback((message: string, tone: Toast["tone"] = "default") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-5 bottom-5 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={
              "max-w-sm rounded-md px-3.5 py-2.5 text-body animate-in fade-in slide-in-from-bottom-2 duration-300 " +
              (t.tone === "error" ? "border-l-2 border-black bg-sheet text-foreground" : "bg-black text-sheet")
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
