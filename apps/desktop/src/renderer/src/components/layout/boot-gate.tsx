import { Outlet } from "react-router-dom";

import { useAuth } from "@/hooks/use-auth";
import { ErrorFallback } from "@/components/error-boundary";

/** Holds the router until the server answered; shows a retry screen when it can't be reached. */
export function BootGate() {
  const { status, bootError, retry } = useAuth();

  if (status === "booting") {
    return (
      <div className="grid min-h-svh place-items-center">
        <p className="text-slate">Starting Photon</p>
      </div>
    );
  }

  if (status === "offline") {
    return (
      <ErrorFallback
        title="The server is not answering"
        message={bootError ?? "Photon could not reach its API server."}
        detail={"Start it from the repo root:\n\n  pnpm server\n\nthen try again."}
        onRetry={() => void retry()}
        retryLabel="Try again"
      />
    );
  }

  return <Outlet />;
}
