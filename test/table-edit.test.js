import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { createState } from "../src/index.js";
import { tableEditSpec, appendRowSpec, tablePasteSpec, inFence } from "../src/core/table.js";
import { enterList } from "../src/core/keys.js";
import { tableAt } from "../src/core/table-model.js";

// Editor-level table edits: the transaction specs the widget dispatches, applied to a real EditorState.
// A "\r\n" document must stay "\r\n" throughout (a bare "\n" would land inside a line), every structural
// edit is one undo step, and pastes respect code blocks.

// A minimal view for StateCommands (undo, enterList): state + dispatch.
const viewOf = (state) => {
  const v = { state, dispatch: (...specs) => { v.state = v.state.update(...specs).state; } };
  return v;
};
const tableLines = (state, fromLine = 1) => {
  const texts = [];
  for (let n = fromLine; n <= state.doc.lines; n++) texts.push(state.doc.line(n).text);
  const m = tableAt(texts, 0);
  return texts.slice(0, m.end + 1);
};
const edit = (state, action, row, col, fromLine = 1) => {
  const res = tableEditSpec(state, state.doc.line(fromLine).from, tableLines(state, fromLine), action, row, col);
  assert.ok(res, action);
  return state.update(res.spec).state;
};
const parse = () => { throw new Error("no HTML in these tests"); };

const CRLF = "| a | b |\r\n| --- | :-: |\r\n| 1 | 2 |\r\nend";

test("CRLF: row insert adds a real line with the document's own separator", () => {
  const s0 = createState(CRLF);
  assert.equal(s0.doc.lines, 4);
  const below = edit(s0, "rowBelow", 1, 0);
  assert.equal(below.doc.lines, 5);
  assert.equal(below.sliceDoc(), "| a | b |\r\n| --- | :-: |\r\n| 1 | 2 |\r\n|  |  |\r\nend");
  const above = edit(s0, "rowAbove", 1, 0);
  assert.equal(above.doc.lines, 5);
  assert.equal(above.sliceDoc(), "| a | b |\r\n| --- | :-: |\r\n|  |  |\r\n| 1 | 2 |\r\nend");
  assert.ok(!/[^\r]\n/.test(below.sliceDoc() + above.sliceDoc()), "no bare \\n");
});

test("CRLF: column insert/delete and row delete keep every \\r\\n", () => {
  const s0 = createState(CRLF);
  const col = edit(s0, "colRight", 1, 0);
  assert.equal(col.sliceDoc(), "| a |  | b |\r\n| --- | --- | :-: |\r\n| 1 |  | 2 |\r\nend");
  assert.equal(col.doc.lines, 4);
  const back = edit(col, "colDelete", 1, 1);
  assert.equal(back.sliceDoc(), CRLF, "insert then delete returns the original bytes");
  const row = edit(s0, "rowDelete", 1, 0);
  assert.equal(row.sliceDoc(), "| a | b |\r\n| --- | :-: |\r\nend");
  assert.equal(row.doc.lines, 3);
});

test("CRLF: appending a row (Tab/Enter past the last cell) and Enter in a list", () => {
  const s0 = createState(CRLF);
  const s1 = s0.update(appendRowSpec(s0, s0.doc.line(3).to, 2)).state;
  assert.equal(s1.sliceDoc(), "| a | b |\r\n| --- | :-: |\r\n| 1 | 2 |\r\n|  |  |\r\nend");
  assert.equal(s1.doc.lines, 5);
  const v = viewOf(createState("- [ ] 하나\r\n끝"));
  v.dispatch({ selection: EditorSelection.cursor(v.state.doc.line(1).to) });
  assert.ok(enterList(v));
  assert.equal(v.state.sliceDoc(), "- [ ] 하나\r\n- [ ] \r\n끝");
  assert.equal(v.state.doc.lines, 3);
});

test("CRLF: a pasted table is written with \\r\\n", () => {
  let s = createState("앞\r\n\r\n뒤");
  s = s.update({ selection: EditorSelection.cursor(s.doc.line(2).from) }).state;
  const spec = tablePasteSpec(s, { html: "", text: "a\tb\n1\t2" }, parse);
  const out = s.update(spec).state;
  assert.equal(out.sliceDoc(), "앞\r\n\r\n| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n뒤");
  assert.equal(out.doc.lines, 7);
  assert.equal(out.doc.lineAt(out.selection.main.head).number, 6, "caret on the blank line below the table");
});

test("one structural edit is one undo step and undo restores the original bytes", () => {
  for (const doc of [CRLF, "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |"]) {
    for (const [action, row, col] of [["rowAbove", 1, 0], ["rowBelow", 0, 1], ["colLeft", 1, 0], ["colRight", 2, 1], ["rowDelete", 1, 0], ["colDelete", 1, 1]]) {
      const v = viewOf(createState(doc));
      // A cell edit right before, as typing in a cell would do (must stay its own step).
      v.dispatch({ changes: { from: 2, to: 3, insert: "x" }, userEvent: "input.type.cell" });
      const typed = v.state.sliceDoc();
      const res = tableEditSpec(v.state, 0, tableLines(v.state), action, row, col);
      v.dispatch(res.spec);
      assert.notEqual(v.state.sliceDoc(), typed, action);
      undo(v);
      assert.equal(v.state.sliceDoc(), typed, `${action}: one undo restores the bytes`);
      undo(v);
      assert.equal(v.state.sliceDoc(), doc);
    }
  }
});

test("rows inserted into an indented table (inside a list item) keep the indentation", () => {
  const doc = "- 목록\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n\n끝";
  const s0 = createState(doc);
  const s1 = edit(s0, "rowBelow", 1, 0, 2);
  assert.equal(s1.sliceDoc(), "- 목록\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n  |  |  |\n\n끝");
  const s2 = s0.update(appendRowSpec(s0, s0.doc.line(4).to, 2)).state;
  assert.equal(s2.doc.line(5).text, "  |  |  |");
});

test("paste: no table conversion inside a fenced code block (TSV stays text)", () => {
  const doc = "글\n```\n코드\n```\n끝";
  const s0 = createState(doc);
  const at = (pos) => s0.update({ selection: EditorSelection.cursor(pos) }).state;
  assert.equal(inFence(s0, s0.doc.line(3).from), true);
  assert.equal(inFence(s0, s0.doc.line(2).from), true, "on the fence line itself");
  assert.equal(inFence(s0, s0.doc.line(5).from), false);
  assert.equal(inFence(s0, 0), false);
  const clip = { html: "", text: "a\tb\n1\t2" };
  assert.equal(tablePasteSpec(at(s0.doc.line(3).to), clip, parse), null);
  assert.ok(tablePasteSpec(at(s0.doc.line(5).to), clip, parse), "outside the fence, plain TSV (no HTML) still converts");
});
