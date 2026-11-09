// Build dist/editframe.mjs — one ESM file with CodeMirror bundled, for no-build hosts to vendor.
import { build } from "esbuild";
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const out = "dist/editframe.mjs";

await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: true,
  legalComments: "eof",
  outfile: out,
  banner: { js: `/*! EditFrame ${pkg.version} | MIT (c) gahmgi | bundles CodeMirror 6 (MIT, Marijn Haverbeke and others) — see THIRD_PARTY_NOTICES.md */` },
});

const buf = readFileSync(out);
const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`${out}: ${kb(statSync(out).size)} raw, ${kb(gzipSync(buf, { level: 9 }).length)} gzip`);
