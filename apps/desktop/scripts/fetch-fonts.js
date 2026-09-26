#!/usr/bin/env node
/**
 * Downloads the UI fonts (Cabinet Grotesk, Satoshi) from Fontshare into
 * src/renderer/src/assets/fonts/.
 *
 * They are free under the ITF Free Font License, which allows embedding them
 * in our own app but not handing the files out through a public repository.
 * So the files are gitignored and every checkout (and build) fetches its own
 * copy from Fontshare. Offline, the app falls back to the stacks in styles.css
 * and this script only warns; it never fails an install.
 */
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "src", "renderer", "src", "assets", "fonts");

// `@1` is Fontshare's variable build (one file covers every weight).
const FONTS = [
  { slug: "cabinet-grotesk", file: "CabinetGrotesk-Variable.woff2" },
  { slug: "satoshi", file: "Satoshi-Variable.woff2" },
];

async function fetchFont({ slug, file }) {
  const target = path.join(OUT, file);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return "present";
  // One font per request: the CSS API mixes up multi-font queries.
  const css = await (await fetch(`https://api.fontshare.com/v2/css?f[]=${slug}@1&display=swap`)).text();
  const match = css.match(/url\('([^']+\.woff2)'\)/);
  if (!match) throw new Error(`no woff2 in Fontshare's CSS for ${slug}`);
  const url = match[1].startsWith("//") ? `https:${match[1]}` : match[1];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  return "downloaded";
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const font of FONTS) {
    try {
      const state = await fetchFont(font);
      if (state === "downloaded") console.log(`[fonts] ${font.file} downloaded from Fontshare`);
    } catch (err) {
      console.warn(`[fonts] could not fetch ${font.file}: ${err.message}. Run "pnpm --filter @photon/desktop fonts" when online.`);
    }
  }
}

void main();
