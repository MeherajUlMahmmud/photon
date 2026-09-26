import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The one bold element in Photon: a black block holding the folder the agent
 * may work in. It is the hero of the Workspace page and the only place the
 * path is set large. `live` adds a blinking caret while a run is active.
 */
export function PathBlock({
  path,
  note,
  live = false,
  className,
  children,
}: {
  path: string | null;
  note?: React.ReactNode;
  live?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg bg-black px-7 py-6 text-sheet", className)}>
      {path ? (
        <p className={cn("type-in font-mono text-[1.75rem] leading-[1.15] wrap-break-word md:text-[2rem]", live && "caret")}>
          <PathSegments path={shortenHome(path)} />
        </p>
      ) : (
        <p className="font-mono text-[1.75rem] leading-[1.15] text-sheet/50 md:text-[2rem]">no folder yet</p>
      )}
      {note && <p className="mt-3 text-body text-sheet/70">{note}</p>}
      {children && <div className="mt-5 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** A path that line-breaks after its slashes, so "misc" never splits into "mis / c". */
function PathSegments({ path }: { path: string }) {
  const parts = path.split("/");
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </React.Fragment>
      ))}
    </>
  );
}

/** "/Users/ada/Projects/x" reads as "~/Projects/x" the way a shell prints it. */
export function shortenHome(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
