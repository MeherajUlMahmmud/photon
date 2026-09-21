import * as React from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import type { LlmProvider } from "../../../../preload/api";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * One quiet trigger for provider + model, grouped by provider in the menu.
 * Reads as a caption under the composer rather than a pair of form controls.
 */
export function ModelPicker({
  providers,
  current,
  model,
  loading,
  onPick,
}: {
  providers: LlmProvider[];
  current: LlmProvider | undefined;
  model: string;
  loading: boolean;
  onPick: (provider: string, model: string) => void;
}) {
  const label = loading ? "Loading providers" : !current ? "No provider has a key" : model || current.default_model;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 w-72 justify-start gap-1.5 px-2 font-normal text-slate"
          disabled={!providers.length}
          aria-label="Choose provider and model"
          title={current ? `${current.name} · ${label}` : label}
        >
          {current && <span className="shrink-0 text-small">{current.name}</span>}
          <span className="min-w-0 flex-1 truncate text-left font-mono text-small text-foreground">{label}</span>
          <CaretDown className="size-3 shrink-0 text-slate" weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {providers.map((p, i) => (
          <React.Fragment key={p.provider}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{p.name}</DropdownMenuLabel>
              {(p.model_ids.length ? p.model_ids : [p.default_model]).map((m) => {
                const active = current?.provider === p.provider && (model || current.default_model) === m;
                return (
                  <DropdownMenuItem key={m} onSelect={() => onPick(p.provider, m)} className="font-mono text-small">
                    <Check className={active ? "opacity-100" : "opacity-0"} weight="bold" />
                    {m}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
