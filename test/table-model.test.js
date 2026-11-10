import { test } from "node:test";
import assert from "node:assert/strict";
import { tableAt, insertRow, deleteRow, insertColumn, deleteColumn } from "../src/core/table-model.js";

// Structural table edits are pure text transforms. Each must touch only what it names: a row edit one line,
// a column edit one cell segment per row. Everything else — padding, alignment colons, escaped pipes,
// ragged rows — stays byte for byte.

const applyAll = (text, res) => {
  assert.ok(res, "expected a change");
  let out = text;
  for (const c of [...res.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
};
const lines = (s) => s.split("\n");
const run = (text, fn, ...args) => applyAll(text, fn(lines(text), ...args));
const model = (text) => tableAt(lines(text), 0);

const T = [
  "| 품목   |  수량 | 메모 |",
  "| :---: | ---: | --- |",
  "|  사과 |     3 | x \\| y |",
  "| 우유 |",
  "| 달걀 | 10 | 신선 | 넘침 |",
].join("\n");

test("insert row below/above touches only one line and keeps every other byte", () => {
  const below = run(T, insertRow, 2, true);
  assert.equal(below, T.replace("| 우유 |", "| 우유 |\n|  |  |  |"));
  const above = run(T, insertRow, 1, false);
  assert.equal(above, T.replace("|  사과", "|  |  |  |\n|  사과"));
  const underHeader = run(T, insertRow, 0, true);
  assert.equal(underHeader, T.replace("| --- |\n", "| --- |\n|  |  |  |\n"), "below the header = first body row");
  assert.equal(insertRow(lines(T), 0, false), null, "nothing goes above the header");
  assert.equal(insertRow(lines(T), 1, true).row, 2);
  assert.equal(model(below).rows.length, 5);
});

test("delete row removes exactly one line; header is protected; last body row may go", () => {
  assert.equal(run(T, deleteRow, 1), T.replace("|  사과 |     3 | x \\| y |\n", ""));
  assert.equal(run(T, deleteRow, 3), T.replace("\n| 달걀 | 10 | 신선 | 넘침 |", ""), "last line takes the line break before it");
  assert.equal(deleteRow(lines(T), 0), null);
  const one = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  const headerOnly = run(one, deleteRow, 1);
  assert.equal(headerOnly, "| a | b |\n| --- | --- |");
  assert.ok(model(headerOnly), "still a table");
  assert.equal(deleteRow(lines(one), 1).row, 0, "focus falls back to the header");
});

test("insert column: one segment per row; alignment, padding, escaped pipes and ragged rows kept", () => {
  const right = run(T, insertColumn, 0, true);
  assert.equal(right, [
    "| 품목   |  |  수량 | 메모 |",
    "| :---: | --- | ---: | --- |",
    "|  사과 |  |     3 | x \\| y |",
    "| 우유 |  |",
    "| 달걀 |  | 10 | 신선 | 넘침 |",
  ].join("\n"));
  const m = model(right);
  assert.equal(m.cols, 4);
  assert.deepEqual(m.align, ["center", null, "right", null]);
  assert.deepEqual(m.rows[1], ["사과", "", "3", "x | y"]);
  assert.deepEqual(m.rows[2], ["우유", "", "", ""]);

  const left = run(T, insertColumn, 2, false);
  assert.equal(left.split("\n")[3], "| 우유 |", "a row shorter than the column is untouched");
  assert.equal(left.split("\n")[2], "|  사과 |     3 |  | x \\| y |");
  assert.deepEqual(model(left).align, ["center", "right", null, null]);

  const last = run(T, insertColumn, 2, true);
  assert.equal(last.split("\n")[0], "| 품목   |  수량 | 메모 |  |");
  assert.equal(last.split("\n")[4], "| 달걀 | 10 | 신선 |  | 넘침 |", "extra cells beyond the header shift right");
  assert.equal(model(last).cols, 4);
});

test("delete column: one segment per row; other bytes kept; the only column cannot go", () => {
  const out = run(T, deleteColumn, 1);
  assert.equal(out, [
    "| 품목   | 메모 |",
    "| :---: | --- |",
    "|  사과 | x \\| y |",
    "| 우유 |",
    "| 달걀 | 신선 | 넘침 |",
  ].join("\n"));
  assert.deepEqual(model(out).align, ["center", null]);
  const first = run(T, deleteColumn, 0);
  assert.equal(first.split("\n")[1], "| ---: | --- |");
  assert.equal(first.split("\n")[3], "|", "a row whose only cell goes keeps a pipe");
  assert.equal(model(first).rows.length, 4, "…so it stays a table row");
  assert.equal(deleteColumn(lines("| a |\n| --- |\n| 1 |"), 0), null);
  assert.equal(deleteColumn(lines(T), 2).col, 1, "focus moves to the left neighbour of the last column");
});

test("tables without outer pipes keep their style where possible and stay tables", () => {
  const P = "a | b\n--|:-:\nc | d";
  assert.equal(run(P, insertColumn, 1, true), "a | b|  |\n--|:-:| --- |\nc | d|  |");
  assert.equal(run(P, insertColumn, 0, false), "|  |a | b\n| --- |--|:-:\n|  |c | d");
  assert.equal(run(P, insertColumn, 0, true), "a |  | b\n--| --- |:-:\nc |  | d");
  const body = (col, right) => model(run(P, insertColumn, col, right)).rows[1];
  assert.deepEqual(body(0, false), ["", "c", "d"]);
  assert.deepEqual(body(0, true), ["c", "", "d"]);
  assert.deepEqual(body(1, false), ["c", "", "d"]);
  assert.deepEqual(body(1, true), ["c", "d", ""]);
  // Down to one column: a row must keep a pipe, so the pipe next to the removed cell stays.
  assert.equal(run(P, deleteColumn, 1), "a |\n--|\nc |");
  assert.equal(run(P, deleteColumn, 0), "| b\n|:-:\n| d");
  for (const col of [0, 1]) assert.equal(model(run(P, deleteColumn, col)).cols, 1);
});

test("an inserted row copies the neighbour row's indentation (tables inside list items)", () => {
  const I = "  | a | b |\n  | --- | --- |\n  | 1 | 2 |";
  assert.equal(run(I, insertRow, 1, true), I + "\n  |  |  |");
  assert.equal(run(I, insertRow, 1, false), "  | a | b |\n  | --- | --- |\n  |  |  |\n  | 1 | 2 |");
  assert.equal(run(I, insertRow, 0, true), "  | a | b |\n  | --- | --- |\n  |  |  |\n  | 1 | 2 |");
  assert.equal(model(run(I, insertRow, 1, true)).rows.length, 3);
});
