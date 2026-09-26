/** Pure sizing and placement for the companion overlay; no Electron imports so it tests under plain node. */

export type Size = { width: number; height: number };
export type Rect = Size & { x: number; y: number };

/**
 * Longest edge sent to the model. Claude downsizes anything larger to about
 * this, and OpenAI's high-detail mode tiles at a similar scale, so bigger
 * captures only cost upload time.
 */
export const MAX_CAPTURE_EDGE = 1568;

export const OVERLAY_SIZE: Size = { width: 420, height: 560 };
const OVERLAY_MARGIN = 16;

/** Pixel size to capture a display at: its native resolution, scaled down to `maxEdge` on the long side. */
export function captureSize(display: Size, scaleFactor: number, maxEdge = MAX_CAPTURE_EDGE): Size {
  const width = Math.max(1, Math.round(display.width * scaleFactor));
  const height = Math.max(1, Math.round(display.height * scaleFactor));
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** Top-right corner of a display's work area, clear of the menu bar and dock. */
export function overlayBounds(workArea: Rect, size: Size = OVERLAY_SIZE): Rect {
  const width = Math.min(size.width, workArea.width - OVERLAY_MARGIN * 2);
  const height = Math.min(size.height, workArea.height - OVERLAY_MARGIN * 2);
  return {
    x: workArea.x + workArea.width - width - OVERLAY_MARGIN,
    y: workArea.y + OVERLAY_MARGIN,
    width,
    height,
  };
}

/** True when `rect` has its centre inside `area`; used to keep a moved overlay where the user left it. */
export function centreInside(rect: Rect, area: Rect): boolean {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return cx >= area.x && cx < area.x + area.width && cy >= area.y && cy < area.y + area.height;
}
