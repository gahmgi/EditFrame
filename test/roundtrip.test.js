import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection } from "@codemirror/state";
import { createState, worknotePreset, toggleTaskAt } from "../src/index.js";
import { BASIC, WORKNOTE, EDGE } from "../lab/samples.js";
import { tableAt, cellEdit, cellPads } from "../src/core/table-model.js";

// The markdown text is the source of truth: building the editor state with every extension, moving the
// caret everywhere and toggling raw/preview must never change a byte. Only real edits change text, and a
// checkbox toggle changes exactly one character.

const corpus = [BASIC, WORKNOTE, ...EDGE];
const optionSets = [
  { name: "core", options: {} },
  { name: "worknote", options: { presets: [worknotePreset()] } },
  { name: "readOnly", options: { presets: [worknotePreset()], readOnly: true } },
  { name: "raw", options: { raw: true } },
];

function diffCount(a, b) {
  if (a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

for (const { name, options } of optionSets) {
  test(`round-trip (${name}): opening, caret moves and selections never change the text`, () => {
    for (const input of corpus) {
      let state = createState(input, options);
      assert.equal(state.sliceDoc(), input, JSON.stringify(input.slice(0, 40)));
      // Walk the caret over every position (exercises every reveal/hide branch of the decorations).
      for (let pos = 0; pos <= state.doc.length; pos++) state = state.update({ selection: EditorSelection.cursor(pos) }).state;
      state = state.update({ selection: EditorSelection.range(0, state.doc.length) }).state;
      assert.equal(state.sliceDoc(), input);
    }
  });
}

test("checkbox toggle changes exactly one character, and toggling back restores the text", () => {
  for (const input of [BASIC, WORKNOTE]) {
    const s0 = createState(input, { presets: [worknotePreset()] });
    let tasks = 0;
    for (let n = 1; n <= s0.doc.lines; n++) {
      const spec = toggleTaskAt(s0, s0.doc.line(n).from);
      if (!spec) continue;
      tasks++;
      const s1 = s0.update(spec).state;
      assert.equal(diffCount(s0.sliceDoc(), s1.sliceDoc()), 1, `line ${n}`);
      const s2 = s1.update(toggleTaskAt(s1, s1.doc.line(n).from)).state;
      assert.equal(s2.sliceDoc(), input);
    }
    assert.ok(tasks >= 2);
  }
});

test("CRLF documents keep their line separator", () => {
  const input = "- [ ] 하나\r\n- [x] 둘\r\n";
  const s0 = createState(input);
  assert.equal(s0.sliceDoc(), input);
  const s1 = s0.update(toggleTaskAt(s0, 0)).state;
  assert.equal(s1.sliceDoc(), "- [x] 하나\r\n- [x] 둘\r\n");
});

// ---------------------------------------------------------------- tables

const lines = (s) => s.split("\n");

test("table detection: header + delimiter, alignment, body rows end at a blank/pipe-less line", () => {
  const t = tableAt(lines("| 품목 | 수량 |\n| :--- | ---: |\n| 사과 | 3 |\n| 우유 \\| 두유 | 1 |\n\n다음"), 0);
  assert.deepEqual(t.align, ["left", "right"]);
  assert.deepEqual(t.rows, [["품목", "수량"], ["사과", "3"], ["우유 | 두유", "1"]]);
  assert.equal(t.end, 3);
  assert.equal(tableAt(lines("| a | b |\n| --- |"), 0), null, "delimiter cell count must match");
  assert.equal(tableAt(lines("그냥 | 문장"), 0), null);
  assert.deepEqual(tableAt(lines("a | b\n--|--\nc | d"), 0).rows, [["a", "b"], ["c", "d"]], "outer pipes are optional");
});

function apply(line, ch) {
  return ch ? line.slice(0, ch.from) + ch.insert + line.slice(ch.to) : line;
}

test("cell edit replaces only that cell's bytes; padding and other cells are untouched", () => {
  const row = "| 사과   |     3 | **제철** |";
  const ch = cellEdit(row, 1, "12");
  assert.equal(apply(row, ch), "| 사과   |     12 | **제철** |", "the original padding is kept as is (no re-alignment)");
  assert.ok(ch.to - ch.from <= 1, "minimal replacement");
  assert.equal(cellEdit(row, 0, "사과"), null, "same text → no change");
  assert.equal(apply("|a|b|", cellEdit("|a|b|", 1, "x|y")), "|a|x\\|y|", "a typed pipe is escaped");
  assert.equal(apply("| 하나 |", cellEdit("| 하나 |", 2, "셋")), "| 하나 |  | 셋 |", "missing cells are appended");
});

test("Atomic Editor #18 scenario: typing `hello world` keeps the space (pads fixed per edit session)", () => {
  let row = "| a |  |";
  const pads = cellPads(row, 1);
  let typed = "";
  for (const ch of "hello world") {
    typed += ch;
    row = apply(row, cellEdit(row, 1, typed, pads));
  }
  assert.equal(row, "| a | hello world |");
  // Two spaces in a row stay two spaces.
  row = apply(row, cellEdit(row, 1, "hello  world", pads));
  assert.equal(row, "| a | hello  world |");
});
