import type { LlmProvider } from "../../../preload/api";

export type ModelPick = { provider: string; model: string };

/**
 * Resolves the provider and model to use from a pick that may be stale: the
 * picked provider may have lost its key, or the model id may be empty.
 */
export function resolveModel(ready: LlmProvider[], pick: ModelPick | null) {
  const current = ready.find((p) => p.provider === pick?.provider) ?? ready[0];
  const model =
    current && pick?.provider === current.provider && pick.model ? pick.model : (current?.default_model ?? "");
  return { current, model };
}
