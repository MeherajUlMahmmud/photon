import * as React from "react";
import {
  ArrowUpRight,
  ArrowCounterClockwise,
  AppWindow,
  PaperPlaneRight,
  PencilSimple,
  Square,
  TextT,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { AnnotationTarget, ChatImage, Screenshot } from "../../../preload/api";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Full-screen overlay (`#/annotate`) over a frozen screenshot of the display.
 * The screen sits under a dark tint; boxes cut a clear window through it so
 * the marked area stands out. Pen, box, arrow and text marks are drawn in
 * window pixels and scaled onto the screenshot on export. The picture goes to
 * the companion or to a new chat in the main window; nothing is saved.
 */

type Tool = "pen" | "box" | "arrow" | "text";
type Point = { x: number; y: number };
type Shape =
  | { kind: "pen"; color: string; points: Point[] }
  | { kind: "box"; color: string; from: Point; to: Point }
  | { kind: "arrow"; color: string; from: Point; to: Point }
  | { kind: "text"; color: string; at: Point; text: string };

/** Marks need to read on any screenshot: warm red, yellow, and off-white. */
const DEFAULT_COLOR = "#f06435";
const COLORS = [DEFAULT_COLOR, "#f5c542", "#fcfbf9"];
const TOOLS: Array<{ id: Tool; label: string; key: string; Icon: typeof PencilSimple }> = [
  { id: "pen", label: "Pen", key: "P", Icon: PencilSimple },
  { id: "box", label: "Box", key: "B", Icon: Square },
  { id: "arrow", label: "Arrow", key: "A", Icon: ArrowUpRight },
  { id: "text", label: "Text", key: "T", Icon: TextT },
];
const MAX_EXPORT_EDGE = 1568;
const STROKE = 4;
const TEXT_SIZE = 22;

const shotUrl = (s: Screenshot) => `data:${s.image.media_type};base64,${s.image.data}`;

function rect(from: Point, to: Point) {
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) };
}

/** Arrowhead points for a line ending at `to`. */
function arrowHead(from: Point, to: Point, size: number): [Point, Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  return [
    { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) },
    to,
    { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) },
  ];
}

const pathOf = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

function isTrivial(shape: Shape): boolean {
  if (shape.kind === "pen") return shape.points.length < 2;
  if (shape.kind === "text") return !shape.text.trim();
  return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) < 6;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("screenshot failed to load"));
    img.src = src;
  });
}

/** Screenshot plus marks, flattened to one JPEG no larger than the model uses. */
async function flatten(shot: Screenshot, shapes: Shape[], view: { w: number; h: number }): Promise<ChatImage> {
  const img = await loadImage(shotUrl(shot));
  const ratio = Math.min(1, MAX_EXPORT_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * ratio);
  canvas.height = Math.round(img.naturalHeight * ratio);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const sx = canvas.width / view.w;
  const sy = canvas.height / view.h;
  const s = (sx + sy) / 2;
  const P = (p: Point) => ({ x: p.x * sx, y: p.y * sy });

  // With boxes drawn, a lighter version of the on-screen spotlight goes into the picture too.
  const boxes = shapes.filter((sh): sh is Extract<Shape, { kind: "box" }> => sh.kind === "box");
  if (boxes.length) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    for (const b of boxes) {
      const r = rect(P(b.from), P(b.to));
      ctx.rect(r.x + r.w, r.y, -r.w, r.h); // reverse winding punches a hole
    }
    ctx.fillStyle = "rgba(20, 21, 23, 0.35)";
    ctx.fill("nonzero");
    ctx.restore();
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const sh of shapes) {
    ctx.strokeStyle = sh.color;
    ctx.fillStyle = sh.color;
    ctx.lineWidth = STROKE * s;
    if (sh.kind === "pen") {
      ctx.beginPath();
      sh.points.map(P).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    } else if (sh.kind === "box") {
      const r = rect(P(sh.from), P(sh.to));
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 6 * s);
      ctx.stroke();
    } else if (sh.kind === "arrow") {
      const from = P(sh.from);
      const to = P(sh.to);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      const head = arrowHead(from, to, 18 * s);
      ctx.moveTo(head[0].x, head[0].y);
      ctx.lineTo(head[1].x, head[1].y);
      ctx.lineTo(head[2].x, head[2].y);
      ctx.stroke();
    } else {
      const at = P(sh.at);
      ctx.font = `700 ${TEXT_SIZE * s}px Satoshi, "Avenir Next", sans-serif`;
      ctx.textBaseline = "top";
      ctx.lineWidth = 5 * s;
      ctx.strokeStyle = "rgba(20, 21, 23, 0.85)";
      ctx.strokeText(sh.text, at.x, at.y);
      ctx.fillText(sh.text, at.x, at.y);
    }
  }
  const url = canvas.toDataURL("image/jpeg", 0.88);
  return { media_type: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
}

function ShapeView({ shape }: { shape: Shape }) {
  const common = { stroke: shape.color, strokeWidth: STROKE, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (shape.kind === "pen") return <path d={pathOf(shape.points)} {...common} />;
  if (shape.kind === "box") {
    const r = rect(shape.from, shape.to);
    return <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} {...common} />;
  }
  if (shape.kind === "arrow") {
    return (
      <g {...common}>
        <path d={pathOf([shape.from, shape.to])} />
        <path d={pathOf(arrowHead(shape.from, shape.to, 18))} />
      </g>
    );
  }
  return (
    <text
      x={shape.at.x}
      y={shape.at.y}
      dominantBaseline="hanging"
      fill={shape.color}
      stroke="rgba(20, 21, 23, 0.85)"
      strokeWidth={5}
      paintOrder="stroke"
      className="font-sans font-bold"
      style={{ fontSize: TEXT_SIZE }}
    >
      {shape.text}
    </text>
  );
}

export function AnnotatePage() {
  const [shot, setShot] = React.useState<Screenshot | null>(null);
  const [shapes, setShapes] = React.useState<Shape[]>([]);
  const [draft, setDraft] = React.useState<Shape | null>(null);
  const [tool, setTool] = React.useState<Tool>("box");
  const [color, setColor] = React.useState<string>(DEFAULT_COLOR);
  const [note, setNote] = React.useState("");
  const [typing, setTyping] = React.useState<{ at: Point; text: string } | null>(null);
  const [sending, setSending] = React.useState<AnnotationTarget | null>(null);
  const noteRef = React.useRef<HTMLInputElement>(null);

  const reset = React.useCallback(() => {
    setShapes([]);
    setDraft(null);
    setTyping(null);
    setNote("");
    setSending(null);
  }, []);

  React.useEffect(() => {
    async function take() {
      const next = await window.photon.takeAnnotationShot();
      if (!next) return;
      reset();
      setShot(next);
    }
    // The first shot can arrive while this page is still loading, so check on mount too.
    void take();
    return window.photon.onAnnotateStart(() => void take());
  }, [reset]);

  const cancel = React.useCallback(() => {
    reset();
    setShot(null);
    void window.photon.cancelAnnotation();
  }, [reset]);

  const undo = React.useCallback(() => setShapes((prev) => prev.slice(0, -1)), []);

  const submit = React.useCallback(
    async (target: AnnotationTarget) => {
      if (!shot || sending) return;
      setSending(target);
      try {
        const committed = typing?.text.trim() ? [...shapes, { kind: "text" as const, color, at: typing.at, text: typing.text }] : shapes;
        const image = await flatten(shot, committed, { w: window.innerWidth, h: window.innerHeight });
        await window.photon.submitAnnotation({ image, note: note.trim(), target });
        reset();
        setShot(null);
      } finally {
        setSending(null);
      }
    },
    [shot, sending, shapes, typing, color, note, reset],
  );

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inField = e.target instanceof HTMLInputElement;
      if (e.key === "Escape") {
        e.preventDefault();
        if (typing) setTyping(null);
        else cancel();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !inField) {
        e.preventDefault();
        undo();
        return;
      }
      if (inField || e.metaKey || e.ctrlKey || e.altKey) return;
      const picked = TOOLS.find((t) => t.key === e.key.toUpperCase());
      if (picked) setTool(picked.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typing, cancel, undo]);

  function point(e: React.PointerEvent): Point {
    return { x: e.clientX, y: e.clientY };
  }

  function commitTyping() {
    if (typing?.text.trim()) setShapes((prev) => [...prev, { kind: "text", color, at: typing.at, text: typing.text.trim() }]);
    setTyping(null);
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const p = point(e);
    if (tool === "text") {
      commitTyping();
      setTyping({ at: p, text: "" });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft(
      tool === "pen"
        ? { kind: "pen", color, points: [p] }
        : tool === "box"
          ? { kind: "box", color, from: p, to: p }
          : { kind: "arrow", color, from: p, to: p },
    );
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draft) return;
    const p = point(e);
    setDraft((d) => {
      if (!d) return d;
      if (d.kind === "pen") return { ...d, points: [...d.points, p] };
      if (d.kind === "box" || d.kind === "arrow") return { ...d, to: p };
      return d;
    });
  }

  function onPointerUp() {
    if (draft && !isTrivial(draft)) setShapes((prev) => [...prev, draft]);
    setDraft(null);
  }

  if (!shot) return <div className="h-svh bg-black" />;

  const visible = draft ? [...shapes, draft] : shapes;
  const holes = visible.filter((s): s is Extract<Shape, { kind: "box" }> => s.kind === "box");

  return (
    <div className="relative h-svh select-none overflow-hidden bg-black">
      <img src={shotUrl(shot)} alt="" className="pointer-events-none absolute inset-0 h-full w-full" draggable={false} />

      <svg
        className={cn("absolute inset-0 h-full w-full animate-reveal", tool === "text" ? "cursor-text" : "cursor-crosshair")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <mask id="spotlight">
            <rect width="100%" height="100%" fill="white" />
            {holes.map((b, i) => {
              const r = rect(b.from, b.to);
              return <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={6} fill="black" />;
            })}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(20 21 23 / 0.55)" mask="url(#spotlight)" />
        {visible.map((s, i) => (
          <ShapeView key={i} shape={s} />
        ))}
      </svg>

      {typing && (
        <input
          autoFocus
          value={typing.text}
          onChange={(e) => setTyping({ ...typing, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTyping();
            }
          }}
          onBlur={commitTyping}
          placeholder="Type a label"
          className="absolute min-w-40 rounded-sm border border-white/30 bg-black/70 px-1.5 py-0.5 font-sans font-bold text-sheet outline-none"
          style={{ left: typing.at.x, top: typing.at.y - 4, fontSize: TEXT_SIZE, color }}
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
        <div className="pointer-events-auto flex max-w-full min-w-0 animate-rise flex-wrap items-center gap-1.5 rounded-xl border border-border bg-sheet p-1.5 shadow-float">
          <div className="flex items-center gap-0.5" role="toolbar" aria-label="Drawing tools">
            {TOOLS.map(({ id, label, key, Icon }) => (
              <Button
                key={id}
                size="icon-sm"
                variant="ghost"
                onClick={() => setTool(id)}
                aria-pressed={tool === id}
                title={`${label} (${key})`}
                aria-label={label}
                className={cn(tool === id && "bg-muted text-foreground")}
              >
                <Icon weight={tool === id ? "bold" : "regular"} />
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1 px-1" role="radiogroup" aria-label="Colour">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  "size-5 rounded-full border border-black/20",
                  color === c && "ring-2 ring-verdigris ring-offset-2 ring-offset-sheet",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          <Button size="icon-sm" variant="ghost" onClick={undo} disabled={!shapes.length} aria-label="Undo" title="Undo (⌘Z)">
            <ArrowCounterClockwise />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setShapes([])} disabled={!shapes.length} aria-label="Clear" title="Clear marks">
            <Trash />
          </Button>
          <span className="mx-0.5 h-6 w-px bg-border" aria-hidden="true" />
          <input
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit("companion");
              }
            }}
            placeholder="Ask about this (optional)"
            aria-label="Question to send with the picture"
            className="h-8 w-64 min-w-0 rounded-md border border-input bg-background px-2.5 text-small outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-verdigris focus-visible:ring-2 focus-visible:ring-verdigris/25"
          />
          <Button size="sm" onClick={() => void submit("companion")} disabled={sending !== null}>
            <PaperPlaneRight weight="bold" />
            {sending === "companion" ? "Sending…" : "Ask companion"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void submit("app")} disabled={sending !== null} title="Start a chat in the Photon window">
            <AppWindow />
            {sending === "app" ? "Opening…" : "New chat"}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={cancel} aria-label="Cancel (Esc)" title="Cancel (Esc)">
            <X />
          </Button>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center px-4">
        <p className="animate-rise rounded-full bg-black/75 px-3 py-1 text-small text-sheet/90 shadow-ambient">
          Draw on the screen. Boxes light up the area you mean. Enter asks the companion, Esc cancels.
        </p>
      </div>
    </div>
  );
}
