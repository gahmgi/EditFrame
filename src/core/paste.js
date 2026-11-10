// Paste a table from a spreadsheet or a web page as a clean GFM table — pure functions (no CodeMirror).
//
//   tableFromHtml(html, parse)  text/html with a <table> → GFM text, or null
//   tableFromTsv(text)          tab-separated text/plain (Excel, Numbers, Sheets) → GFM text, or null
//   tableFromClipboard({ html, text }, parse)   HTML first, TSV as the fallback
//   placeTable(table, around)   blank-line separation so the table stands on its own lines
//   singleLine(text)            paste inside a table cell: one line (the cell edit escapes `|`)
//
// `parse(html)` returns a DOM-like tree. In the browser it is DOMParser (it never runs scripts); tests pass a
// hand-built tree. Only these node fields are read: nodeType (1 element, 3 text), nodeName, childNodes,
// nodeValue, getAttribute(name).
//
// Merged cells are not kept (GFM has no syntax for them): a rowspan repeats the value in every covered row; a
// colspan puts the value in the first cell and leaves the covered cells empty.

import { escapeCell } from "./table-model.js";

export const browserParse = (html) => new DOMParser().parseFromString(html, "text/html");

const SKIP = new Set(["STYLE", "SCRIPT", "TEMPLATE", "HEAD", "TITLE"]);
const BREAK = new Set(["BR", "P", "DIV", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6"]);
const name = (n) => String(n.nodeName || "").toUpperCase();

// A cell's text on one line: whitespace and line breaks collapse to single spaces, `|` becomes `\|`.
export function cleanCell(text) {
  return escapeCell(String(text || "").replace(/[\s ]+/g, " ").trim());
}

function textOf(node) {
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1 || SKIP.has(name(node))) return "";
  let s = "";
  for (const c of node.childNodes || []) s += textOf(c);
  return BREAK.has(name(node)) ? ` ${s} ` : s;
}

function findTable(node) {
  if (node.nodeType === 1 && name(node) === "TABLE") return node;
  for (const c of node.childNodes || []) {
    const t = findTable(c);
    if (t) return t;
  }
  return null;
}

// Rows of this table only (not of a table nested in a cell).
function rowsOf(table) {
  const rows = [];
  for (const c of table.childNodes || []) {
    const n = name(c);
    if (n === "TR") rows.push(c);
    else if (n === "THEAD" || n === "TBODY" || n === "TFOOT") for (const r of c.childNodes || []) if (name(r) === "TR") rows.push(r);
  }
  return rows;
}

// rowspan="0" runs to the last row; colspan="0" counts as 1 (HTML rules). Both are capped.
const span = (cell, attr, max) => {
  const v = parseInt(cell.getAttribute?.(attr) ?? "", 10);
  if (v === 0 && attr === "rowspan") return max;
  return Math.max(1, Math.min(Number.isFinite(v) ? v : 1, max));
};

// GFM text for a grid (first row = header). Null unless it has at least 2 rows and 2 columns — a single
// copied cell or a single line stays ordinary text.
export function gridToGfm(grid) {
  const cols = Math.max(0, ...grid.map((r) => r.length));
  if (grid.length < 2 || cols < 2) return null;
  const line = (cells) => "| " + cells.join(" | ") + " |";
  const rows = grid.map((r) => line(Array.from({ length: cols }, (_, c) => r[c] ?? "")));
  return [rows[0], line(Array(cols).fill("---")), ...rows.slice(1)].join("\n");
}

export function tableFromHtml(html, parse = browserParse) {
  if (!html || !/<table[\s>]/i.test(html)) return null;
  let root;
  try { root = parse(html); } catch { return null; }
  const table = root && findTable(root);
  if (!table) return null;
  const trs = rowsOf(table);
  const grid = trs.map(() => []);
  trs.forEach((tr, r) => {
    let c = 0;
    for (const cell of tr.childNodes || []) {
      const n = name(cell);
      if (n !== "TD" && n !== "TH") continue;
      while (grid[r][c] !== undefined) c++;
      const rs = span(cell, "rowspan", trs.length - r), cs = span(cell, "colspan", 100);
      const text = cleanCell(textOf(cell));
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) grid[r + dr][c + dc] = dc === 0 ? text : "";
      c += cs;
    }
  });
  for (const row of grid) for (let c = 0; c < row.length; c++) if (row[c] === undefined) row[c] = "";
  return gridToGfm(grid.filter((r) => r.length));
}

// Tab-separated values as spreadsheets put them on the clipboard: quoted fields may hold tabs, line breaks and
// doubled quotes. Returns rows of raw fields, or null for an unterminated quote.
export function parseTsv(text) {
  const s = String(text || "").replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (s[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === "\t") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (quoted) return null;
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// TSV → GFM when it looks like a sheet: at least 2 lines, the same column count (≥ 2) on every line, and
// not every line starting with a tab (that is indented text such as code, not a table).
export function tableFromTsv(text) {
  if (!String(text || "").includes("\t")) return null;
  const rows = parseTsv(text);
  if (!rows || rows.length < 2) return null;
  const cols = rows[0].length;
  if (cols < 2 || rows.some((r) => r.length !== cols)) return null;
  if (rows.every((r) => r[0] === "")) return null;
  return gridToGfm(rows.map((r) => r.map(cleanCell)));
}

// Excel and Sheets put both HTML and TSV on the clipboard: prefer the HTML, fall back to TSV when the HTML
// yields nothing. HTML without any table (a rich-text editor, a code editor) means the source is not a
// sheet, so its tab-indented plain text is left alone.
export function tableFromClipboard({ html, text } = {}, parse = browserParse) {
  if (html && /<table[\s>]/i.test(html)) {
    const t = tableFromHtml(html, parse);
    if (t) return t;
  } else if (html && html.trim()) return null;
  return tableFromTsv(text);
}

// Where the table goes: on its own lines, separated by a blank line from text before and after it.
//   around: { before, after } — text on the caret's line before/after the replaced range;
//           { prev, next }    — the neighbouring lines (null at the document edge)
// Returns { text, caret } — caret is an offset from the insertion start, on the line after the table, so typing
// does not land in the table's last row.
export function placeTable(table, { before = "", after = "", prev = null, next = null } = {}) {
  const head = before !== "" ? "\n\n" : prev != null && prev.trim() ? "\n" : "";
  let tail, skip = 0;
  if (after !== "") tail = "\n\n";
  else if (next == null || next.trim()) tail = "\n";
  else { tail = ""; skip = 1; }
  const text = head + table + tail;
  return { text, caret: text.length + skip };
}

// Paste inside a table cell: a single line. A trailing line break (a copied spreadsheet cell has one) is
// dropped; other line breaks and tabs become spaces. The cell edit (table-model cellEdit) escapes `|`.
export function singleLine(text) {
  return String(text || "").replace(/(\r\n|\r|\n)+$/, "").replace(/\r\n|[\r\n\t]/g, " ");
}
