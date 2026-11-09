import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection } from "@codemirror/state";
import { createState } from "../src/index.js";
import { preview } from "../src/core/preview.js";

// The IME guard at state level: while composing or "hot" (just typed), decorations are only mapped,
// never recomputed. Browser behaviour (CodeMirror reading real IME input) is covered by
// scripts/replay-traces.mjs; real iOS needs a device.

const countDeco = (state) => { let n = 0; state.field(preview).deco.between(0, state.doc.length, () => { n++; }); return n; };
const type = (state, text, userEvent = "input.type") => {
  const h = state.selection.main.head;
  return state.update({ changes: { from: h, insert: text }, selection: EditorSelection.cursor(h + text.length), userEvent }).state;
};

test("typing makes the field hot and maps decorations instead of rebuilding them", () => {
  let s = createState("- [ ] 장보기\n두 번째 줄");
  s = s.update({ selection: EditorSelection.cursor(s.doc.line(1).to) }).state;
  const before = countDeco(s);
  s = type(s, " **굵");
  assert.equal(s.field(preview).frozen, "hot");
  assert.equal(countDeco(s), before, "no new bold decoration while hot");
  s = type(s, "게**");
  assert.equal(countDeco(s), before);
  assert.equal(s.sliceDoc(), "- [ ] 장보기 **굵게**\n두 번째 줄");
  // Caret leaves the line → recompute now (bold markers get hidden).
  s = s.update({ selection: EditorSelection.cursor(s.doc.length) }).state;
  assert.equal(s.field(preview).frozen, false);
  assert.ok(countDeco(s) > before);
});

test("selection moves within the hot line keep the frozen set", () => {
  let s = createState("가나다\n라");
  s = s.update({ selection: EditorSelection.cursor(3) }).state;
  s = type(s, "마");
  const frozen = s.field(preview);
  s = s.update({ selection: EditorSelection.cursor(1) }).state;
  assert.equal(s.field(preview), frozen);
});

test("composition transactions freeze as 'compose'; insertReplacementText-style replace stays mapped", () => {
  let s = createState("**굵게** ");
  s = type(s, "ㅌ", "input.type.compose");
  assert.equal(s.field(preview).frozen, "compose");
  // WebKit replacement: the previous letter is replaced (arrives as a DOM change → input.type).
  const h = s.selection.main.head;
  s = s.update({ changes: { from: h - 1, to: h, insert: "테" }, selection: EditorSelection.cursor(h), userEvent: "input.type" }).state;
  assert.equal(s.field(preview).frozen, "compose", "still composing — not downgraded to hot");
  assert.equal(s.sliceDoc(), "**굵게** 테");
});

test("non-typing edits (Enter list continuation, checkbox, undo) recompute immediately", () => {
  let s = createState("- [ ] 가");
  s = type(s, "나");
  assert.equal(s.field(preview).frozen, "hot");
  s = s.update({ changes: { from: s.doc.length, insert: "\n- [ ] " }, selection: EditorSelection.cursor(s.doc.length + 7), userEvent: "input" }).state;
  assert.equal(s.field(preview).frozen, false);
});
