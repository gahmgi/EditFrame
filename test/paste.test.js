import { test } from "node:test";
import assert from "node:assert/strict";
import { tableFromHtml, tableFromTsv, tableFromClipboard, parseTsv, placeTable, singleLine } from "../src/core/paste.js";
import { tableAt, cellEdit } from "../src/core/table-model.js";

// Pasting tables from Excel, Numbers, Sheets or a web page. The converters get a DOM-like tree; in the
// browser that is DOMParser, here a tiny parser that is just good enough for clipboard HTML.

const VOID = new Set(["br", "col", "meta", "img", "link", "hr", "input"]);
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " ", "#39": "'" };
function parse(html) {
  const el = (nodeName, attrs = {}) => ({ nodeType: 1, nodeName: nodeName.toUpperCase(), childNodes: [], getAttribute: (k) => attrs[k] ?? null });
  const root = el("#document");
  const stack = [root];
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|[^<]+/g)) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith("<!--")) continue;
    if (!m[2]) { top.childNodes.push({ nodeType: 3, nodeValue: m[0].replace(/&(#?\w+);/g, (x, e) => ENT[e] ?? x) }); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((n) => n.nodeName).lastIndexOf(tag.toUpperCase());
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? a[5];
    const node = el(tag, attrs);
    top.childNodes.push(node);
    if (!VOID.has(tag) && !m[3].trim().endsWith("/")) stack.push(node);
  }
  return root;
}
const rowsOf = (gfm) => tableAt(gfm.split("\n"), 0).rows;

// Shaped like Excel's clipboard HTML: style block, conditional comments, <col>, &nbsp;, a <br> in a cell.
const EXCEL = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><style>
td { mso-number-format:General; } .xl65 { color: red; }
</style></head><body><!--StartFragment--><table border=0 cellpadding=0 cellspacing=0 width=200>
<col width=64 span=3>
<tr height=20><td height=20 width=64>품목</td><td width=64>수량</td><td width=64>메모</td></tr>
<tr height=20><td height=20>사과</td><td align=right>3</td><td class=xl65>빨강&nbsp;|&nbsp;초록</td></tr>
<tr height=20><td height=20>우유</td><td align=right>1</td><td>두 줄<br>메모</td></tr>
<!--EndFragment--></table></body></html>`;

test("Excel HTML: first row is the header, whitespace collapses, pipes are escaped", () => {
  const gfm = tableFromHtml(EXCEL, parse);
  assert.equal(gfm, "| 품목 | 수량 | 메모 |\n| --- | --- | --- |\n| 사과 | 3 | 빨강 \\| 초록 |\n| 우유 | 1 | 두 줄 메모 |");
  assert.deepEqual(rowsOf(gfm), [["품목", "수량", "메모"], ["사과", "3", "빨강 | 초록"], ["우유", "1", "두 줄 메모"]]);
});

test("merged cells: rowspan repeats the value per row; colspan fills the first cell, the rest empty", () => {
  const html = `<table>
    <tr><th>요일</th><th colspan="2">할 일</th></tr>
    <tr><td rowspan="2">월</td><td>장보기</td><td>운동</td></tr>
    <tr><td>독서</td><td>청소</td></tr>
    <tr><td colspan="2" rowspan="2">휴식</td><td>산책</td></tr>
    <tr><td>정리</td></tr>
  </table>`;
  assert.deepEqual(rowsOf(tableFromHtml(html, parse)), [
    ["요일", "할 일", ""],
    ["월", "장보기", "운동"],
    ["월", "독서", "청소"],
    ["휴식", "", "산책"],
    ["휴식", "", "정리"],
  ]);
});

test("web tables: thead/tbody/tfoot rows in order, nested tables do not add rows, ragged rows padded", () => {
  const html = `<p>앞 글</p><table><thead><tr><th>이름</th><th>값</th></tr></thead>
    <tbody><tr><td>가 <b>굵게</b></td><td><table><tr><td>안쪽</td></tr></table></td></tr>
    <tr><td>짧은 행</td></tr></tbody><tfoot><tr><td>합계</td><td>2</td></tr></tfoot></table>`;
  assert.deepEqual(rowsOf(tableFromHtml(html, parse)), [["이름", "값"], ["가 굵게", "안쪽"], ["짧은 행", ""], ["합계", "2"]]);
});

test("not a table: one cell, one column, no <table>", () => {
  assert.equal(tableFromHtml("<table><tr><td>하나</td></tr></table>", parse), null, "a single copied cell stays text");
  assert.equal(tableFromHtml("<table><tr><td>a</td></tr><tr><td>b</td></tr></table>", parse), null);
  assert.equal(tableFromHtml("<p>글</p>", parse), null);
  assert.equal(tableFromHtml("", parse), null);
});

test("TSV: quoted fields (tabs, line breaks, doubled quotes), trailing newline, empty cells", () => {
  assert.deepEqual(parseTsv('a\t"b\tc"\n"줄\n바꿈"\t"말 ""인용"""\n'), [["a", "b\tc"], ["줄\n바꿈", '말 "인용"']]);
  assert.equal(parseTsv('"열린 따옴표\tx'), null);
  const gfm = tableFromTsv("품목\t수량\t메모\r\n사과\t3\t\r\n우유\t1\ta|b\r\n");
  assert.equal(gfm, "| 품목 | 수량 | 메모 |\n| --- | --- | --- |\n| 사과 | 3 |  |\n| 우유 | 1 | a\\|b |");
  assert.deepEqual(rowsOf(gfm)[2], ["우유", "1", "a|b"]);
  assert.deepEqual(rowsOf(tableFromTsv('이름\t메모\n가\t"두\n줄"')), [["이름", "메모"], ["가", "두 줄"]]);
});

test("TSV: not a table — one line, one column, uneven columns, tab-indented text", () => {
  assert.equal(tableFromTsv("a\tb"), null);
  assert.equal(tableFromTsv("a\nb"), null);
  assert.equal(tableFromTsv("a\tb\nc"), null);
  assert.equal(tableFromTsv("\tif (x) {\n\t\ty();"), null);
  assert.equal(tableFromTsv("\tone\n\ttwo"), null, "every line starts with a tab: indentation, not a table");
});

test("clipboard: HTML preferred; TSV when the HTML has no usable table; rich text without a table is left alone", () => {
  const tsv = "a\tb\n1\t2";
  assert.equal(tableFromClipboard({ html: EXCEL, text: tsv }, parse).split("\n")[0], "| 품목 | 수량 | 메모 |");
  assert.equal(tableFromClipboard({ html: "<table><tr><td>a</td></tr></table>", text: tsv }, parse), "| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.equal(tableFromClipboard({ html: "", text: tsv }, parse), "| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.equal(tableFromClipboard({ html: "<pre>a\tb\n1\t2</pre>", text: tsv }, parse), null);
  assert.equal(tableFromClipboard({ html: "", text: "그냥 글" }, parse), null);
});

test("placement: the table gets its own lines and blank-line separation; the caret goes below it", () => {
  const T = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  // Mid-line: blank lines on both sides, caret at the start of the rest of the line.
  let p = placeTable(T, { before: "앞", after: "뒤", prev: null, next: null });
  assert.equal(p.text, "\n\n" + T + "\n\n");
  assert.equal(p.caret, p.text.length);
  // Empty line between paragraphs: one blank line each side.
  p = placeTable(T, { before: "", after: "", prev: "위 문단", next: "아래 문단" });
  assert.equal(p.text, "\n" + T + "\n");
  // Already separated by blank lines: nothing extra; caret skips onto the existing blank line.
  p = placeTable(T, { before: "", after: "", prev: "", next: "" });
  assert.deepEqual(p, { text: T, caret: T.length + 1 });
  // Document end: a new empty line for the caret.
  p = placeTable(T, { before: "", after: "", prev: "", next: null });
  assert.deepEqual(p, { text: T + "\n", caret: T.length + 1 });
  // The inserted text reads back as the table.
  const doc = "위 문단" + "\n" + placeTable(T, { prev: "위 문단", next: "아래" }).text + "\n아래";
  assert.equal(tableAt(doc.split("\n"), 2).rows.length, 2);
  assert.equal(doc.split("\n")[1], "");
});

test("cell paste: one line, tabs/newlines become spaces, a trailing newline is dropped, pipes escaped on commit", () => {
  assert.equal(singleLine("사과\t3\r\n우유\t1\r\n"), "사과 3 우유 1");
  assert.equal(singleLine("값\n"), "값");
  const row = "| a |  |";
  const ch = cellEdit(row, 1, singleLine("x|y\nz"));
  assert.equal(row.slice(0, ch.from) + ch.insert + row.slice(ch.to), "| a | x\\|y z |");
});
