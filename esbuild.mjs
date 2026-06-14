/**
 * Build script. Two outputs into dist/:
 *
 *   1. dist/builder.html — the widget shell with the bundled widget JS + CSS
 *      inlined into a single self-contained file. The server reads this and hands
 *      it to the host as the ui:// resource. MCP App resources must be a single
 *      HTML document (the host renders it in a sandboxed iframe), so everything
 *      gets inlined — no external <script src> / <link href>.
 *
 *   2. dist/index.js + dist/server.js — the Node server, bundled (deps external).
 */

import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, "dist");
await fs.mkdir(dist, { recursive: true });

// --- 1. Widget: bundle TS -> one IIFE string, inline into the HTML shell ---
const widgetBundle = await esbuild.build({
  entryPoints: [path.join(root, "src/widget/widget.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: false, // keep it readable — this is a teaching repo
  write: false,
});
const widgetJs = widgetBundle.outputFiles[0].text;
const css = await fs.readFile(path.join(root, "src/widget/styles.css"), "utf-8");
const shell = await fs.readFile(path.join(root, "src/widget/widget.html"), "utf-8");

// Use function replacements so `$` sequences in the CSS/JS are treated literally
// (String.replace would otherwise interpret $&, $1, $$ in the replacement).
const html = shell
  .replace("/* INLINE_CSS */", () => css)
  .replace("// INLINE_JS", () => widgetJs);

await fs.writeFile(path.join(dist, "builder.html"), html, "utf-8");

// --- 2. Server: bundle for Node, keep deps external ---
await esbuild.build({
  entryPoints: [path.join(root, "src/index.ts"), path.join(root, "src/server.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outdir: dist,
  packages: "external",
});

console.log("built -> dist/builder.html, dist/index.js, dist/server.js");
