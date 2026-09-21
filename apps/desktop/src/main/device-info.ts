import { app } from "electron";
import { basename } from "node:path";
import type { DeviceInfo } from "../preload/api.js";

/** Login shell on POSIX, PowerShell on Windows (what `bash`-style commands would actually run in). */
function defaultShell(): string {
  if (process.platform === "win32") return "powershell";
  const shell = process.env.SHELL;
  return shell ? basename(shell) : "sh";
}

/**
 * What the server needs to know about this machine to shape the agent's
 * commands and answers: platform, OS version, arch, shell and locale. No
 * hostname, username or paths — nothing that identifies the user.
 */
export function deviceInfo(): DeviceInfo {
  return {
    os: process.platform as DeviceInfo["os"],
    // "15.5" on macOS, "10.0.22631" on Windows, the kernel release on Linux.
    os_version: process.getSystemVersion(),
    arch: process.arch,
    shell: defaultShell(),
    locale: app.getLocale(),
    app_version: app.getVersion(),
  };
}
