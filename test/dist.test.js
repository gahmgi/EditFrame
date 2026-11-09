import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { BASIC, WORKNOTE } from "../lab/samples.js";

// The built single file (what consumers vendor) must expose the API and round-trip the samples.
test("dist/editframe.mjs exports the API and round-trips the samples", { skip: !existsSync(new URL("../dist/editframe.mjs", import.meta.url)) && "run npm run build first" }, async () => {
  const ef = await import("../dist/editframe.mjs");
  for (const name of ["createEditor", "createState", "worknotePreset", "toggleTaskAt", "EditorView", "EditorState", "VERSION"]) assert.ok(ef[name], name);
  for (const doc of [BASIC, WORKNOTE]) assert.equal(ef.createState(doc, { presets: [ef.worknotePreset()] }).sliceDoc(), doc);
});
