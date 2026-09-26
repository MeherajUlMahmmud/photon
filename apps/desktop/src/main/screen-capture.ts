import { desktopCapturer, screen, systemPreferences } from "electron";
import type { CaptureResult, ScreenPermission } from "../preload/api.js";
import { captureSize, MAX_CAPTURE_EDGE } from "./companion-layout.js";

/** Whether this app may read the screen. macOS asks once; elsewhere it is always `granted`. */
export function screenPermission(): ScreenPermission {
  if (process.platform !== "darwin") return "granted";
  try {
    return systemPreferences.getMediaAccessStatus("screen");
  } catch {
    return "unknown";
  }
}

/**
 * Captures the display under the pointer as a JPEG, long edge capped at
 * `maxEdge`. The companion sends it straight to the model (1568 px); the
 * annotate overlay asks for more so drawing on it stays sharp.
 */
export async function captureDisplay(maxEdge = MAX_CAPTURE_EDGE, quality = 80): Promise<CaptureResult> {
  const permission = screenPermission();
  // `denied` or `restricted`: macOS would hand back wallpaper only; don't pretend.
  // `not-determined` still calls through, because the first call is what makes macOS ask.
  if (permission === "denied" || permission === "restricted") return { screenshot: null, permission };

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const size = captureSize(display.size, display.scaleFactor, maxEdge);
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    const after = screenPermission();
    if (!source || source.thumbnail.isEmpty() || after !== "granted") return { screenshot: null, permission: after };
    const actual = source.thumbnail.getSize();
    return {
      permission: after,
      screenshot: {
        image: { media_type: "image/jpeg", data: source.thumbnail.toJPEG(quality).toString("base64") },
        width: actual.width,
        height: actual.height,
        capturedAt: Date.now(),
      },
    };
  } catch (err) {
    console.warn("[capture] failed:", err);
    return { screenshot: null, permission: screenPermission() };
  }
}
