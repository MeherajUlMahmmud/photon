import * as React from "react";
import { Link } from "react-router-dom";
import type { Skill } from "../../../../preload/api";

import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";

/**
 * The list that opens above the composer while a `/command` is being typed.
 * Keyboard handling stays in the textarea (the composer forwards arrow keys,
 * Enter, Tab and Escape) so focus never leaves the field; the mouse can pick
 * too. `activeIndex` is the highlighted row.
 */
export function SkillMenu({
  skills,
  query,
  activeIndex,
  onHover,
  onPick,
}: {
  skills: Skill[];
  query: string;
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (skill: Skill) => void;
}) {
  const listRef = React.useRef<HTMLUListElement>(null);

  // Keep the highlighted row in view as arrows move it.
  React.useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      role="listbox"
      aria-label="Skills"
      className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
    >
      {skills.length ? (
        <ul ref={listRef} className="max-h-64 overflow-y-auto p-1">
          {skills.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                // mousedown, not click: keep the textarea focused.
                e.preventDefault();
                onPick(s);
              }}
              className={cn(
                "flex cursor-default items-baseline gap-3 rounded-sm px-2 py-1.5",
                i === activeIndex && "bg-accent text-accent-foreground",
              )}
            >
              <span className="shrink-0 font-mono text-small">/{s.name}</span>
              <span className="min-w-0 flex-1 truncate text-small text-slate">{s.description}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-3 text-small text-slate">
          {query ? (
            <>
              No skill matches <span className="font-mono">/{query}</span>.
            </>
          ) : (
            <>
              No skills yet.{" "}
              <Link to="/settings/skills" className="underline decoration-input underline-offset-4 hover:decoration-black">
                Install one in Settings
              </Link>
              .
            </>
          )}
        </p>
      )}
      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 font-mono text-micro text-slate">
        <span>
          <Kbd>↑↓</Kbd> move
        </span>
        <span>
          <Kbd>Tab</Kbd> pick
        </span>
        <span>
          <Kbd>Esc</Kbd> close
        </span>
      </div>
    </div>
  );
}
