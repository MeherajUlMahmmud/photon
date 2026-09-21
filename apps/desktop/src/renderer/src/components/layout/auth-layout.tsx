import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "@/hooks/use-auth";

/**
 * Sign-in and register. Two columns: the black block on the left carries the
 * one idea Photon is built on, the form sits on the sheet to the right.
 */
export function AuthLayout() {
  const { status, info } = useAuth();
  if (status === "authenticated") return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-svh md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-black p-12 text-sheet md:flex">
        <div className="flex items-center gap-2.5">
          <span className="size-2.5 rotate-45 rounded-[2px] bg-sheet" aria-hidden="true" />
          <span className="text-lead">{info?.name ?? "Photon"}</span>
        </div>
        <div className="max-w-[26ch]">
          <p className="font-mono text-[2rem] leading-[1.15] caret">~/Projects</p>
          <p className="mt-6 text-lead text-sheet/70">
            You hand Photon one folder. It reads and writes there, shows you every command first, and touches nothing else.
          </p>
        </div>
        <p className="text-small text-sheet/50">Local first. Your files stay on this Mac.</p>
      </aside>
      <main className="grid place-items-center bg-sheet p-8 md:p-16">
        <div className="w-full max-w-[26rem]">
          <div className="mb-10 flex items-center gap-2.5 md:hidden">
            <span className="size-2.5 rotate-45 rounded-[2px] bg-black" aria-hidden="true" />
            <span className="text-lead">{info?.name ?? "Photon"}</span>
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
