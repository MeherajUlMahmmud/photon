import * as React from "react";

import { errorMessage } from "@/lib/utils";

type AsyncState<T> =
  | { status: "loading"; data: undefined; error: null }
  | { status: "success"; data: T; error: null }
  | { status: "error"; data: undefined; error: string };

/**
 * Small data hook for page loads: runs `fn` on mount and whenever `deps`
 * change, ignores results from a stale run, and exposes `reload`.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [state, setState] = React.useState<AsyncState<T>>({ status: "loading", data: undefined, error: null });
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setState((s) => (s.status === "success" ? s : { status: "loading", data: undefined, error: null }));
    fn().then(
      (data) => alive && setState({ status: "success", data, error: null }),
      (err) => alive && setState({ status: "error", data: undefined, error: errorMessage(err) }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = React.useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload, loading: state.status === "loading" };
}
