import { test } from "node:test";
import assert from "node:assert/strict";
import { scanLine, scanBlock, indentLevel, isFence, isHr, touches, revealsPrefix, continueList, toggledCheckChar, createScanner, shortUrl } from "../src/core/marks.js";
import { worknotePreset, WN_LINK_RE, WN_OP_RE } from "../src/presets/worknote.js";

// Live-preview judgement. Each test cuts the hidden ranges and checks the letters left over — an
// off-by-one shows on screen only as one missing letter or one leftover marker fragment.
// Tests 1–12 are ported from the WorkNote editor lab (editor-lab-marks.test.js).

// Reference implementations of WorkNote's own helpers (connections.js), so the preset is checked
// against the same behaviour without importing the app.
const parseInternalLinks = (body) => [...String(body).matchAll(new RegExp(WN_LINK_RE.source, "gi"))].map((m) => ({ title: m[1].trim(), id: m[2].toLowerCase() }));
const stripOpMarkers = (body) => String(body).replace(/\n?[ \t]*<!--\s*wn-op:.*?-->/gi, "");

const wn = worknotePreset();
const scanWN = createScanner({ rules: wn.rules, alwaysHide: wn.alwaysHide });

function visible(text, ranges) {
  const cut = [...ranges].sort((a, b) => a[0] - b[0]);
  let out = "", at = 0;
  for (const [a, b] of cut) { out += text.slice(at, Math.max(at, a)); at = Math.max(at, b); }
  return out + text.slice(at);
}
const hidesOf = (sc) => [...(sc.block ? [[sc.block.from, sc.block.to]] : []), ...sc.ops, ...sc.inline.flatMap((e) => e.hide)];

test("1 heading: hiding `## ` leaves the title", () => {
  const b = scanBlock("## 오늘의 계획");
  assert.deepEqual(b, { type: "heading", level: 2, from: 0, to: 3 });
  assert.equal(visible("## 오늘의 계획", [[b.from, b.to]]), "오늘의 계획");
  assert.equal(scanBlock("##붙은것"), null, "# without a space is not a heading");
});

test("2 task: indent, state, marker range", () => {
  assert.deepEqual(scanBlock("- [ ] 할 일"), { type: "task", level: 0, checked: false, from: 0, to: 6, box: 2, marker: "-" });
  assert.deepEqual(scanBlock("  - [x] 완료"), { type: "task", level: 1, checked: true, from: 2, to: 8, box: 4, marker: "-" });
  assert.equal(scanBlock("    - [X] 대문자").checked, true);
  assert.deepEqual(scanBlock("- [ ]"), { type: "task", level: 0, checked: false, from: 0, to: 5, box: 2, marker: "-" });
  assert.equal(scanBlock("- [ ]뒤붙음").type, "bullet", "`- [ ]text` is a bullet, not a task");
});

test("3 bullet: `-` `*` `+`, two columns per level (tab = two)", () => {
  assert.deepEqual(scanBlock("- 항목"), { type: "bullet", level: 0, from: 0, to: 2, marker: "-" });
  assert.deepEqual(scanBlock("    - 항목"), { type: "bullet", level: 2, from: 4, to: 6, marker: "-" });
  // Changed from the WorkNote lab: the generic core also accepts `*` and `+` bullets.
  assert.equal(scanBlock("* 별표").type, "bullet");
  assert.equal(scanBlock("+ 더하기").marker, "+");
  assert.equal(scanBlock("-붙음"), null);
  assert.equal(scanBlock("* * *"), null, "a rule is not a bullet");
  assert.equal(indentLevel("\t"), 1);
  assert.equal(indentLevel("   "), 1);
});

test("4 bold and underline: only the letters remain", () => {
  const t = "회의 **다음 주 일정** 확정 <u>금요일</u>";
  const sc = scanLine(t);
  assert.deepEqual(sc.inline.map((e) => e.type), ["bold", "underline"]);
  assert.equal(visible(t, hidesOf(sc)), "회의 다음 주 일정 확정 금요일");
  assert.equal(scanLine("** 띄운 것 **").inline.length, 0, "content starting/ending with a space is not bold");
});

test("5 WorkNote link: title only, same token as WorkNote's parser", () => {
  const id = "0b7c9a52-3f1e-4c2a-9d84-6a1f2e3b4c5d";
  const t = `- [ ] [[독서 메모|${id}]] 다시 읽기`;
  const sc = scanWN(t);
  const link = sc.inline.find((e) => e.type === "wnlink");
  assert.equal(link.id, id);
  assert.equal(visible(t, hidesOf(sc)), "독서 메모 다시 읽기");
  assert.deepEqual(parseInternalLinks(t).map((l) => l.id), sc.inline.filter((e) => e.type === "wnlink").map((e) => e.id));
  assert.equal(scanWN("[[제목만]]").inline.length, 0, "no UUID, no token");
  assert.equal(scanLine(t).inline.filter((e) => e.type === "wnlink").length, 0, "the core alone does not know this syntax");
});

test("6 markdown link shows text only; bare URL keeps its text and gets link styling", () => {
  const t = "[여행 계획](https://example.org/x) 정리, 참고 https://example.com/a?id=42.";
  const sc = scanLine(t);
  assert.deepEqual(sc.inline.map((e) => e.type), ["mdlink", "url"]);
  assert.equal(sc.inline[0].href, "https://example.org/x");
  assert.equal(sc.inline[1].href, "https://example.com/a?id=42", "a trailing period is not part of the URL");
  assert.equal(visible(t, hidesOf(sc)), "여행 계획 정리, 참고 https://example.com/a?id=42.");
});

test("7 wn-op markers: inline and whole-line, same result as WorkNote stripOpMarkers", () => {
  const inline = "- 11:05 정리 <!-- wn-op:abc-1 -->";
  const sc = scanWN(inline);
  assert.equal(sc.opOnly, false);
  assert.equal(visible(inline, sc.ops), stripOpMarkers(inline));
  assert.equal(scanWN("  <!-- wn-op:abc-2 -->").opOnly, true);
  assert.equal(scanWN("<!-- 그냥 주석 -->").ops.length, 0, "other comments are untouched");
  assert.equal(scanLine(inline).ops.length, 0, "the core alone does not hide them");
});

test("8 overlap: bold link keeps both; `**` inside a link target is not bold", () => {
  const id = "0b7c9a52-3f1e-4c2a-9d84-6a1f2e3b4c5d";
  const t = `**[[제목|${id}]]**`;
  const sc = scanWN(t);
  assert.deepEqual(sc.inline.map((e) => e.type).sort(), ["bold", "wnlink"]);
  assert.equal(visible(t, hidesOf(sc)), "제목");
  assert.deepEqual(scanLine("[글](https://x.com/**a**)").inline.map((e) => e.type), ["mdlink"]);
});

test("9 fences and rules are recognised", () => {
  assert.ok(isFence("```js"));
  assert.ok(!isFence("`인라인`"));
  assert.ok(isHr("---"));
  assert.ok(isHr("* * *"));
  assert.ok(!isHr("-- 두 개"));
});

test("10 reveal: inline marks on touch; a caret right after a line marker does not reveal it", () => {
  assert.equal(touches([{ from: 5, to: 5 }], 5, 10), true);
  assert.equal(touches([{ from: 10, to: 10 }], 5, 10), true);
  assert.equal(touches([{ from: 11, to: 11 }], 5, 10), false);
  assert.equal(touches([{ from: 0, to: 20 }], 5, 10), true, "a covering selection reveals");
  assert.equal(revealsPrefix([{ from: 106, to: 106 }], 100, 106), false, "caret of a new item — keep hidden");
  assert.equal(revealsPrefix([{ from: 100, to: 100 }], 100, 106), true, "caret at line start reveals");
  assert.equal(revealsPrefix([{ from: 103, to: 103 }], 100, 106), true);
  assert.equal(revealsPrefix([{ from: 104, to: 110 }], 100, 106), true, "a selection over the marker reveals");
  assert.equal(revealsPrefix([{ from: 107, to: 107 }], 100, 106), false);
});

test("11 Enter: continue the list at the same indent; an empty item ends it", () => {
  assert.deepEqual(continueList("- [x] 끝난 일", 9), { insert: "\n- [ ] " }, "after a done item comes an empty box");
  assert.deepEqual(continueList("  - 하위", 6), { insert: "\n  - " });
  assert.deepEqual(continueList("- [ ] ", 6), { clear: [0, 6] });
  assert.deepEqual(continueList("  - ", 4), { clear: [2, 4] });
  assert.equal(continueList("## 제목", 5), null, "headings: plain newline");
  assert.equal(continueList("그냥 문장", 3), null);
  assert.equal(continueList("- [ ] 할 일", 3), null, "caret inside the marker: default");
  assert.deepEqual(continueList("* 별표 항목", 7), { insert: "\n* " }, "keeps the bullet character");
  assert.deepEqual(continueList("9. 아홉째", 6), { insert: "\n10. " }, "ordered lists count up");
  assert.deepEqual(continueList("> 인용", 4), { insert: "\n> " });
});

test("12 checkbox toggle changes one character (done is a lowercase x)", () => {
  assert.equal(toggledCheckChar("- [ ] a", 2), "x");
  assert.equal(toggledCheckChar("- [x] a", 2), " ");
  assert.equal(toggledCheckChar("- [X] a", 2), " ");
});

test("italic, strikethrough, inline code; code content is not parsed", () => {
  const t = "*기울임* 과 _밑줄표기_ 와 ~~취소~~ 그리고 `**코드**`";
  const sc = scanLine(t);
  assert.deepEqual(sc.inline.map((e) => e.type), ["italic", "italic", "strike", "code"]);
  assert.equal(visible(t, hidesOf(sc)), "기울임 과 밑줄표기 와 취소 그리고 **코드**");
  assert.equal(scanLine("snake_case_name").inline.length, 0, "underscores inside words are not italic");
  assert.equal(scanLine("2 * 3 * 4").inline.length, 0);
});

test("ordered list and quote markers", () => {
  assert.deepEqual(scanBlock("  3. 셋째"), { type: "ordered", level: 1, from: 2, to: 5, number: 3, delim: "." });
  assert.deepEqual(scanBlock("> 인용문"), { type: "quote", level: 0, from: 0, to: 2 });
});

test("long bare URLs get a short label; short ones none", () => {
  assert.equal(shortUrl("https://example.com/a"), null);
  const label = shortUrl("https://www.example.com/very/long/path/to/some/resource?with=query&and=more");
  assert.ok(label.startsWith("example.com/very/long"));
  assert.ok(label.length <= 40 && label.endsWith("…"));
});

test("preset regexes are reusable across calls", () => {
  assert.ok(WN_LINK_RE.global && WN_OP_RE.global);
  const id = "0b7c9a52-3f1e-4c2a-9d84-6a1f2e3b4c5d";
  for (let k = 0; k < 3; k++) assert.equal(scanWN(`[[가|${id}]] [[나|${id}]]`).inline.length, 2);
});
