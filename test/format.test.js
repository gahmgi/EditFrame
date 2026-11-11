import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleBoldSelection, toggleStrikeSelection, toggleUnderlineSelection } from "../src/core/format.js";
import { scanLine } from "../src/core/marks.js";

// Apply a toggle result to a line the way keys.js formatWith does.
function apply(fn, line, from, to) {
  const res = fn(line.slice(from, to), { before: line.slice(0, from), after: line.slice(to) });
  if (res.noop) return { line, res };
  const start = from - (res.dropBefore || 0), end = to + (res.dropAfter || 0);
  return { line: line.slice(0, start) + res.text + line.slice(end), res, sel: [start + res.caretStart, start + res.caretEnd] };
}

test("strike: wrap a selection, and the result renders as strikethrough", () => {
  const { line, sel } = apply(toggleStrikeSelection, "지난 일정 정리", 0, 5);
  assert.equal(line, "~~지난 일정~~ 정리");
  assert.equal(line.slice(...sel), "지난 일정", "selection stays on the letters");
  assert.deepEqual(scanLine(line).inline.map((e) => e.type), ["strike"]);
});

test("strike: toggling twice restores the text (selection of the letters inside, or of the whole span)", () => {
  const src = "할 일 정리";
  const once = apply(toggleStrikeSelection, src, 0, 3);
  const back = apply(toggleStrikeSelection, once.line, ...once.sel);
  assert.equal(back.line, src);
  assert.equal(apply(toggleStrikeSelection, "~~할 일~~ 정리", 0, 7).line, src);
});

test("strike: empty selection inserts a pair with the caret in the middle", () => {
  const r = toggleStrikeSelection("", { before: "a ", after: "" });
  assert.deepEqual(r, { text: "~~~~", caretStart: 2, caretEnd: 2 });
});

test("strike: mixed markers are left alone (no stacking, no half-unwrap)", () => {
  assert.ok(toggleStrikeSelection("가 ~~나~~ 다", { before: "", after: "" }).noop);
  assert.ok(toggleStrikeSelection("~~a~~ 와 ~~b~~", { before: "", after: "" }).noop);
});

test("strike and bold are independent", () => {
  const bold = apply(toggleBoldSelection, "~~취소~~", 2, 4);
  assert.equal(bold.line, "~~**취소**~~");
  const strike = apply(toggleStrikeSelection, "**굵게**", 2, 4);
  assert.equal(strike.line, "**~~굵게~~**");
  // Unwrap strike from inside a bold+strike span.
  assert.equal(apply(toggleStrikeSelection, "**~~굵게~~**", 4, 6).line, "**굵게**");
});

test("bold keeps its behaviour after sharing the helper", () => {
  assert.equal(apply(toggleBoldSelection, "가나다", 0, 3).line, "**가나다**");
  assert.equal(apply(toggleBoldSelection, "**가나다**", 2, 5).line, "가나다");
  assert.ok(toggleBoldSelection("**a** and **b**", { before: "", after: "" }).noop);
  assert.ok(toggleBoldSelection("a ** b", { before: "", after: "" }).noop);
  assert.equal(apply(toggleUnderlineSelection, "가", 0, 1).line, "<u>가</u>");
});
