import * as React from "react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";

type FallbackProps = {
  title: string;
  message: string;
  detail?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  onHome?: () => void;
};

/** Shared UI for the boot screen, the root boundary and route boundaries. */
export function ErrorFallback({ title, message, detail, onRetry, retryLabel = "Try again", onHome }: FallbackProps) {
  const [showDetail, setShowDetail] = React.useState(false);
  return (
    <div className="grid min-h-full place-items-center p-8">
      <div className="w-full max-w-[52ch]">
        <h1 className="text-display">{title}</h1>
        <p className="mt-3 text-lead text-slate">{message}</p>

        {detail && (
          <div className="mt-5">
            <button type="button" className="text-small text-slate underline decoration-input underline-offset-4 hover:text-foreground" onClick={() => setShowDetail((v) => !v)}>
              {showDetail ? "Hide details" : "Show details"}
            </button>
            {showDetail && (
              <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-black p-4 font-mono text-small leading-[1.6] whitespace-pre-wrap text-sheet">
                {detail}
              </pre>
            )}
          </div>
        )}

        <div className="mt-8 flex gap-2">
          {onRetry && <Button onClick={onRetry}>{retryLabel}</Button>}
          {onHome && (
            <Button variant="outline" onClick={onHome}>
              Back to the workspace
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type BoundaryState = { error: Error | null; info: string | null };

/**
 * Class boundary for render errors anywhere below it. Wrap the whole tree so
 * a bug in one page never leaves a blank window; `key` it on the route to
 * reset automatically on navigation.
 */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <ErrorFallback
          title="This part of Photon stopped working"
          message={errorMessage(err)}
          detail={[err.stack, this.state.info].filter(Boolean).join("\n")}
          onRetry={this.reset}
          onHome={() => {
            window.location.hash = "#/";
            this.reset();
          }}
        />
      );
    }
    return this.props.children;
  }
}

/** react-router `errorElement`: catches loader/render errors per route, keeps the shell alive. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  if (isRouteErrorResponse(error)) {
    return (
      <ErrorFallback
        title={error.status === 404 ? "There is no page at this address" : `The request failed (${error.status})`}
        message={error.statusText || errorMessage(error.data)}
        onHome={() => navigate("/")}
      />
    );
  }

  const err = error instanceof Error ? error : new Error(String(error));
  return (
    <ErrorFallback
      title="This page stopped working"
      message={errorMessage(err)}
      detail={err.stack}
      onRetry={() => navigate(0)}
      retryLabel="Reload the page"
      onHome={() => navigate("/")}
    />
  );
}
