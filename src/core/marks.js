// Live-preview *judgement* — pure functions (no DOM, no CodeMirror).
//
// Given one line of markdown, report where the syntax markers are and what is left when they are hidden.
// Turning that into CodeMirror decorations is preview.js's job. The judgement lives here because position
// arithmetic that is off by one is silent on screen (a letter vanishes, a marker fragment stays) — the node
// tests in test/marks.test.js lock it down.
//
// The stored format is plain markdown. Nothing here changes the text; it only decides how it looks.
//
// Ported from the WorkNote editor lab (editor-lab-marks.js, same author) and generalised:
//   - `*` / `+` bullets, ordered lists, block quotes, horizontal rules, italic, strikethrough, inline code
//   - product-specific inline syntax comes in through `rules` (see src/presets/worknote.js)

const HEADING_RE = /^(#{1,6})[ \t]+/;
const TASK_RE = /^([ \t]*)([-*+])[ \t]+\[([ xX])\](?:[ \t]|$)/;
const BULLET_RE = /^([ \t]*)([-*+])[ \t]+/;
const ORDERED_RE = /^([ \t]*)(\d{1,9})([.)])[ \t]+/;
const QUOTE_RE = /^([ \t]{0,3})>[ \t]?/;
const HR_RE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_RE = /^[ \t]*(```|~~~)/;

const URL_RE = /https?:\/\/[^\s<>()\[\]"'`]+/g;

// Core inline rules, in priority order. `exclusive` rules may not overlap anything already taken
// (nothing is parsed inside a code span or a link target). Product presets are inserted after `code`.
//   parts(m) → { hide: [[a, b], …] (offsets relative to m.index), ...extra fields }
const CODE_RULE = {
  type: "code", exclusive: true, opaque: true, re: /(`+)([^`\n]*?[^`\n])\1(?!`)/g,
  parts: (m) => ({ hide: [[0, m[1].length], [m[0].length - m[1].length, m[0].length]] }),
};
const CORE_RULES_AFTER_PRESETS = [
  {
    type: "mdlink", exclusive: true, re: /(!?)\[([^\]\n]+)\]\(([^)\s]+)(?:[ \t]+"[^"\n]*")?\)/g,
    parts: (m) => {
      const open = m[1].length + 1;
      return { hide: [[0, open], [open + m[2].length, m[0].length]], href: m[3], image: m[1] === "!" };
    },
  },
  { type: "url", exclusive: true, re: URL_RE, url: true },
  { type: "bold", re: /\*\*(?=\S)(.*?\S)\*\*/g, parts: (m) => ({ hide: [[0, 2], [m[0].length - 2, m[0].length]] }) },
  { type: "bold", re: /(?<![\p{L}\p{N}_])__(?=\S)(.*?\S)__(?![\p{L}\p{N}_])/gu, parts: (m) => ({ hide: [[0, 2], [m[0].length - 2, m[0].length]] }) },
  { type: "underline", re: /<u>(.+?)<\/u>/g, parts: (m) => ({ hide: [[0, 3], [m[0].length - 4, m[0].length]] }) },
  // One or two tildes, as GFM and marked (`del: /^(~~?)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]|$)/`) — a host that
  // renders a view with marked shows `~a~` struck, so the editor must too.
  { type: "strike", re: /(?<!~)(~~?)(?=[^\s~])(.*?[^\s~])\1(?!~)/g, parts: (m) => ({ hide: [[0, m[1].length], [m[0].length - m[1].length, m[0].length]] }) },
  { type: "italic", re: /(?<![*\p{L}\p{N}])\*(?=[^\s*])(.*?[^\s*])\*(?![*\p{L}\p{N}])/gu, parts: (m) => ({ hide: [[0, 1], [m[0].length - 1, m[0].length]] }) },
  { type: "italic", re: /(?<![_\p{L}\p{N}])_(?=[^\s_])(.*?[^\s_])_(?![_\p{L}\p{N}])/gu, parts: (m) => ({ hide: [[0, 1], [m[0].length - 1, m[0].length]] }) },
];

// Indent depth. Two columns are one level; a tab counts as two columns.
export function indentLevel(indent) {
  let cols = 0;
  for (const ch of String(indent || "")) cols += ch === "\t" ? 2 : 1;
  return Math.floor(cols / 2);
}

export function isFence(text) { return FENCE_RE.test(String(text || "")); }
export function isHr(text) { return HR_RE.test(String(text || "")); }

// Line-leading marker (heading, task, bullet, ordered item, quote). `from..to` is the marker range;
// indentation stays before `from`. Returns null for a plain line.
export function scanBlock(text) {
  const s = String(text == null ? "" : text);
  let m = HEADING_RE.exec(s);
  if (m) return { type: "heading", level: m[1].length, from: 0, to: m[0].length };
  if (HR_RE.test(s)) return null; // `* * *` / `- - -` is a rule, not a bullet
  m = TASK_RE.exec(s);
  if (m) {
    const indent = m[1];
    const box = s.indexOf("[", indent.length);
    // Hide one space after the box too. A line that ends in `- [ ]` has nothing after it.
    const to = Math.min(box + 4, s.length);
    return { type: "task", level: indentLevel(indent), checked: m[3] !== " ", from: indent.length, to, box, marker: m[2] };
  }
  m = BULLET_RE.exec(s);
  if (m) return { type: "bullet", level: indentLevel(m[1]), from: m[1].length, to: m[0].length, marker: m[2] };
  m = ORDERED_RE.exec(s);
  if (m) return { type: "ordered", level: indentLevel(m[1]), from: m[1].length, to: m[0].length, number: Number(m[2]), delim: m[3] };
  m = QUOTE_RE.exec(s);
  if (m) return { type: "quote", level: 0, from: m[1].length, to: m[0].length };
  return null;
}

const overlaps = (a, b) => a.from < b.to && b.from < a.to;
// Crossing = overlapping boundaries. One element wholly containing another is fine (`**[[title|id]]**`).
const crosses = (a, b) => overlaps(a, b) && !(a.from <= b.from && b.to <= a.to) && !(b.from <= a.from && a.to <= b.to);

function globalRe(re) {
  return re.global ? re : new RegExp(re.source, re.flags + "g");
}

// Build a line scanner for a configuration.
//   rules      — extra inline rules from presets (same shape as the core rules; exclusive by default)
//   alwaysHide — regexes whose matches are hidden even when the caret touches them
export function createScanner({ rules = [], alwaysHide = [] } = {}) {
  const presetRules = rules.map((r) => ({ exclusive: true, ...r, re: globalRe(r.re) }));
  const ordered = [CODE_RULE, ...presetRules, ...CORE_RULES_AFTER_PRESETS];
  const hiders = alwaysHide.map(globalRe);

  // Scan one line. Every position is an offset **within the line**.
  //   block   — scanBlock result
  //   inline  — [{ type, from, to, hide: [[a,b],…], href?, …extra }] sorted by from
  //   ops     — always-hidden ranges
  //   opOnly  — the line consists of always-hidden matches only (hide the whole line)
  return function scanLine(text) {
    const s = String(text == null ? "" : text);
    const ops = [];
    for (const re of hiders) for (const m of s.matchAll(re)) if (m[0]) ops.push([m.index, m.index + m[0].length]);
    ops.sort((a, b) => a[0] - b[0]);
    let rest = s;
    if (ops.length) {
      rest = "";
      let at = 0;
      for (const [a, b] of ops) { rest += s.slice(at, Math.max(at, a)); at = Math.max(at, b); }
      rest += s.slice(at);
    }
    const opOnly = ops.length > 0 && rest.trim() === "";

    const taken = ops.map(([from, to]) => ({ from, to }));
    const inline = [];
    const add = (el) => {
      if (taken.some((t) => crosses(t, el) || (t.opaque && overlaps(t, el)))) return;
      // Nothing may land inside another element's hidden marker (e.g. `**` inside a link target).
      if (inline.some((o) => o.hide.some(([a, b]) => overlaps({ from: a, to: b }, el)) && !(el.from <= o.from && o.to <= el.to))) return;
      taken.push(el);
      inline.push(el);
    };

    for (const rule of ordered) {
      rule.re.lastIndex = 0;
      for (const m of s.matchAll(rule.re)) {
        let el;
        if (rule.url) {
          const url = m[0].replace(/[.,;:!?]+$/, "");
          el = { type: "url", from: m.index, to: m.index + url.length, hide: [], href: url };
        } else {
          const p = rule.parts(m);
          const { hide, ...extra } = p;
          el = { ...extra, type: rule.type, from: m.index, to: m.index + m[0].length, hide: hide.map(([a, b]) => [m.index + a, m.index + b]) };
          if (rule.className) el.className = rule.className;
          if (rule.opaque) el.opaque = true; // nothing is parsed inside (code spans)
        }
        if (el.to <= el.from) continue;
        if (rule.exclusive && taken.some((t) => overlaps(t, el))) continue;
        add(el);
      }
    }
    inline.sort((a, b) => a.from - b.from || b.to - a.to);
    return { block: scanBlock(s), inline, ops, opOnly };
  };
}

// Default scanner (core rules only).
export const scanLine = createScanner();

// ---------- when to reveal markers ----------
// `sels` is [{ from, to }] in document positions. Markers show only when the caret touches **that element**
// (Obsidian-style, element-wise — not the whole line). Revealing per line would make `- [ ] ` pop out on
// every keystroke in a task line, which is exactly the "raw symbols" users asked us to remove.

// Inline marks (bold, underline, links): revealed when the caret touches either end.
export function touches(sels, from, to) {
  return (sels || []).some((r) => r.from <= to && r.to >= from);
}

// Line-leading markers: a caret sitting **right after** the marker (before the first content letter)
// does not reveal it — every new list item puts the caret there, so revealing would flash `- ` on every
// item. Backspace at that spot deletes the whole marker instead (keys.js).
export function revealsPrefix(sels, lineFrom, markerTo) {
  return (sels || []).some((r) => r.from <= markerTo && r.to >= lineFrom && !(r.from === r.to && r.from === markerTo));
}

// ---------- Enter: continue a list ----------
// Only when the caret is after the marker. Returns:
//   { insert }        — text to insert at the caret (newline + same indent + marker)
//   { clear: [a, b] } — Enter on an empty item: remove the marker to end the list (line offsets)
//   null              — default behaviour (plain newline)
export function continueList(text, caret) {
  const s = String(text == null ? "" : text);
  const b = scanBlock(s);
  if (!b || b.type === "heading" || caret < b.to) return null;
  const indent = s.slice(0, b.from);
  if (s.slice(b.to).trim() === "" && caret >= s.length) return { clear: [b.from, s.length] };
  let marker;
  if (b.type === "task") marker = `${b.marker} [ ] `;
  else if (b.type === "bullet") marker = `${b.marker} `;
  else if (b.type === "ordered") marker = `${b.number + 1}${b.delim} `;
  else marker = s.slice(b.from, b.to) || "> ";
  return { insert: "\n" + indent + marker };
}

// Flip the state character of a checkbox. `box` is the line offset of `[`. Done is a lowercase x.
export function toggledCheckChar(text, box) {
  const ch = String(text || "")[box + 1];
  return ch === " " ? "x" : " ";
}

// Shortened label for a long bare URL: host + path, cut at `max` characters.
export function shortUrl(href, max = 40) {
  const s = String(href || "");
  if (s.length <= max) return null;
  const noScheme = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  return noScheme.length <= max ? noScheme : noScheme.slice(0, max - 1) + "…";
}
