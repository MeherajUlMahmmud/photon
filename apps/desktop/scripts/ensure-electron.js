#!/usr/bin/env node
/**
 * Electron's install.js sometimes leaves dist/ extracted but omits path.txt.
 * Ensure path.txt exists when the platform binary is already on disk.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function platformPath() {
  switch (os.platform()) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "win32":
      return "electron.exe";
    default:
      return "electron";
  }
}

try {
  const electronPkg = path.dirname(require.resolve("electron/package.json"));
  const pathTxt = path.join(electronPkg, "path.txt");
  const binary = path.join(electronPkg, "dist", platformPath());

  if (!fs.existsSync(binary)) {
    console.warn(
      "[ensure-electron] Electron binary missing; run: pnpm rebuild electron",
    );
    process.exit(0);
  }

  if (!fs.existsSync(pathTxt) || fs.readFileSync(pathTxt, "utf8") !== platformPath()) {
    fs.writeFileSync(pathTxt, platformPath());
    console.log("[ensure-electron] wrote path.txt");
  }
} catch (err) {
  console.warn("[ensure-electron]", err instanceof Error ? err.message : err);
}
