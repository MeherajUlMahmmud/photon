import * as React from "react";

import { cn } from "@/lib/utils";

const KEY_STEP = 16;

/**
 * A vertical drag strip on one edge of a panel that sets the panel's width.
 * `edge` is the edge the strip sits on: dragging away from the panel widens it.
 * Double-click resets; arrow keys nudge it for keyboard users.
 */
export function ResizeHandle({
  edge,
  value,
  min,
  max,
  onChange,
  onReset,
  onDraggingChange,
  label,
  className,
}: {
  edge: "left" | "right";
  value: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  onReset?: () => void;
  onDraggingChange?: (dragging: boolean) => void;
  label: string;
  className?: string;
}) {
  const start = React.useRef<{ x: number; width: number } | null>(null);
  const sign = edge === "right" ? 1 : -1;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width: value };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    onDraggingChange?.(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    onChange(start.current.width + sign * (e.clientX - start.current.x));
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onDraggingChange?.(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Arrow toward the panel shrinks it, away widens it, whichever edge the handle is on.
    const delta = e.key === "ArrowRight" ? KEY_STEP : e.key === "ArrowLeft" ? -KEY_STEP : 0;
    if (delta) {
      e.preventDefault();
      onChange(value + sign * delta);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(max);
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn(
        "group/handle absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none",
        edge === "right" ? "-right-1" : "-left-1",
        // The visible line: 1px at rest (matches the panel border), 2px and darker on hover/focus/drag.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors after:duration-150",
        "hover:after:w-0.5 hover:after:bg-verdigris focus-visible:after:w-0.5 focus-visible:after:bg-verdigris",
        className,
      )}
    />
  );
}
