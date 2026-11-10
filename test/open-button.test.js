import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection } from "@codemirror/state";
import { createState, worknotePreset } from "../src/index.js";
import { preview, refresh } from "../src/core/preview.js";

// 「열기 ↗」 (touch screens): shown after the link or note chip that holds the caret, never while typing or
// composing, never at the link's edge (where typing continues), never in the text.

const DOC = "앞 [요리 레시피](https://example.org/recipes) 뒤\n[[독서 메모|0b7c9a52-3f1e-4c2a-9d84-6a1f2e3b4c5d]] 칩\n주소 https://example.com/a 끝";
const buttons = (state) => {
  const out = [];
  state.field(preview).deco.between(0, state.doc.length, (from, to, d) => { if (d.spec.widget?.open) out.push({ at: from, ...d.spec.widget.info }); });
  return out;
};
const at = (state, pos) => state.update({ selection: EditorSelection.cursor(pos) }).state;
const opts = { presets: [worknotePreset()], openButton: true };

test("caret strictly inside a link, a note chip or a bare URL shows one button at its end", () => {
  const s0 = createState(DOC, opts);
  const link = DOC.indexOf("[요리"), linkEnd = DOC.indexOf(" 뒤");
  let s = at(s0, link + 3);
  assert.deepEqual(buttons(s), [{ at: linkEnd, type: "mdlink", href: "https://example.org/recipes", id: null }]);
  const chip = DOC.indexOf("[[독서");
  s = at(s0, chip + 4);
  assert.deepEqual(buttons(s), [{ at: DOC.indexOf(" 칩"), type: "wnlink", href: null, id: "0b7c9a52-3f1e-4c2a-9d84-6a1f2e3b4c5d" }]);
  const url = DOC.indexOf("https://example.com");
  s = at(s0, url + 5);
  assert.deepEqual(buttons(s).map((b) => [b.at, b.type]), [[DOC.indexOf(" 끝"), "url"]]);
  assert.equal(s.sliceDoc(), DOC, "drawing only — the text is unchanged");
});

test("no button at a link's edge, outside links, with a selection, when off, or read-only", () => {
  const s0 = createState(DOC, opts);
  assert.equal(buttons(at(s0, DOC.indexOf("[요리"))).length, 0, "at the start edge");
  assert.equal(buttons(at(s0, DOC.indexOf(" 뒤"))).length, 0, "at the end edge (typing continues there)");
  assert.equal(buttons(at(s0, 1)).length, 0);
  assert.equal(buttons(s0.update({ selection: EditorSelection.range(DOC.indexOf("[요리") + 2, DOC.indexOf("[요리") + 5) }).state).length, 0);
  assert.equal(buttons(at(createState(DOC, { ...opts, openButton: false }), DOC.indexOf("[요리") + 3)).length, 0);
  assert.equal(buttons(at(createState(DOC, { ...opts, readOnly: true }), DOC.indexOf("[요리") + 3)).length, 0);
});

test("typing inside a link: no button appears while hot; it comes back only after the idle refresh", () => {
  let s = at(createState(DOC, opts), DOC.indexOf("[요리") + 3);
  assert.equal(buttons(s).length, 1);
  // Start from outside the link, then type into it: frozen decorations are only mapped (no new button).
  s = at(createState(DOC, opts), 1);
  s = s.update({ changes: { from: 1, insert: "가" }, selection: EditorSelection.cursor(2), userEvent: "input.type" }).state;
  assert.equal(s.field(preview).frozen, "hot");
  s = at(s, DOC.indexOf("[요리") + 4); // same line: still hot
  assert.equal(buttons(s).length, 0, "not shown during the hot window");
  s = s.update({ changes: { from: s.selection.main.head, insert: "나" }, selection: EditorSelection.cursor(s.selection.main.head + 1), userEvent: "input.type" }).state;
  assert.equal(buttons(s).length, 0, "not shown while typing inside the link");
  s = s.update({ changes: { from: s.selection.main.head, insert: "ㄷ" }, selection: EditorSelection.cursor(s.selection.main.head + 1), userEvent: "input.type.compose" }).state;
  assert.equal(s.field(preview).frozen, "compose");
  assert.equal(buttons(s).length, 0, "not shown while composing");
  // The idle refresh (what compositionWatch dispatches once input settles) brings it back, caret unmoved.
  const head = s.selection.main.head;
  s = s.update({ effects: refresh.of(null) }).state;
  assert.equal(s.field(preview).frozen, false);
  assert.equal(s.selection.main.head, head);
  const after = buttons(s);
  assert.equal(after.length, 1, "shown again after the idle refresh");
  assert.equal(after[0].type, "mdlink");
  assert.equal(after[0].at, s.sliceDoc().indexOf(" 뒤"), "at the end of the (now longer) link");
});
