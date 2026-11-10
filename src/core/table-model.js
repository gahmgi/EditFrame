// GFM table model — pure functions (no DOM, no CodeMirror).
//
// The table widget (table.js) never re-serialises a whole table. Editing a cell replaces **only that cell's
// bytes** in its row line; every other row, the delimiter row (`:---:` alignment) and all padding stay as they
// were. This is the main difference from Atomic Editor's table widget, which rebuilt the full table from its
// DOM model on every keystroke (dropping alignment and normalising whitespace — see THIRD_PARTY_NOTICES.md).
//
// Cell splitting (unescaped `|` separates cells, optional outer pipes) follows Atomic Editor's
// `splitRowCells` (MIT), rewritten to return offsets so edits can be range-precise.

// Is the `|` at index i escaped by an odd run of backslashes?
function escapedAt(s, i) {
  let n = 0;
  for (let k = i - 1; k >= 0 && s[k] === "\\"; k--) n++;
  return n % 2 === 1;
}

// Cell segments of one row line: [{ from, to }] — the text between pipes (padding included),
// outer pipes excluded. Returns [] for a line without any unescaped pipe.
export function splitCells(line) {
  const s = String(line || "");
  const pipes = [];
  for (let i = 0; i < s.length; i++) if (s[i] === "|" && !escapedAt(s, i)) pipes.push(i);
  if (!pipes.length) return [];
  const firstNonWs = s.search(/\S/);
  const lastNonWs = s.length - 1 - (s.match(/\s*$/)[0].length);
  const left = pipes[0] === firstNonWs ? pipes.shift() : -1;
  const right = pipes.length && pipes[pipes.length - 1] === lastNonWs ? pipes.pop() : s.length;
  const bounds = [left, ...pipes, right];
  const out = [];
  for (let k = 0; k < bounds.length - 1; k++) out.push({ from: bounds[k] + 1, to: bounds[k + 1] });
  return out;
}

const DELIM_CELL_RE = /^\s*:?-+:?\s*$/;

export function isDelimiterRow(line) {
  const s = String(line || "");
  if (!s.includes("|")) return false;
  const cells = splitCells(s);
  return cells.length > 0 && cells.every((c) => DELIM_CELL_RE.test(s.slice(c.from, c.to)));
}

function alignOf(cell) {
  const t = cell.trim();
  const l = t.startsWith(":"), r = t.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : null;
}

// Display text of a cell: trimmed, `\|` shown as `|`.
export function cellText(line, seg) {
  return String(line).slice(seg.from, seg.to).trim().replace(/\\\|/g, "|");
}

// Try to read a table starting at line index `i` of `lines` (array of strings, 0-based).
// GFM: a header row with pipes, then a delimiter row with the same cell count; body rows continue until a
// blank line or a line without a pipe. Returns { start, end, align, rows } (rows[0] = header) or null.
export function tableAt(lines, i) {
  const head = lines[i];
  if (head == null || !head.includes("|") || i + 1 >= lines.length) return null;
  const delim = lines[i + 1];
  if (!isDelimiterRow(delim)) return null;
  const hc = splitCells(head);
  const dc = splitCells(delim);
  if (!hc.length || hc.length !== dc.length) return null;
  const align = dc.map((c) => alignOf(delim.slice(c.from, c.to)));
  const rows = [hc.map((c) => cellText(head, c))];
  let end = i + 1;
  for (let k = i + 2; k < lines.length; k++) {
    const t = lines[k];
    if (!t.trim() || !t.includes("|") || /^[ \t]*(```|~~~)/.test(t)) break;
    const cs = splitCells(t);
    const row = [];
    for (let c = 0; c < hc.length; c++) row.push(cs[c] ? cellText(t, cs[c]) : "");
    rows.push(row);
    end = k;
  }
  return { start: i, end, align, cols: hc.length, rows };
}

// Line index (relative to the table start) of logical row r: row 0 is the header, the delimiter sits at 1.
export const rowLine = (r) => (r === 0 ? 0 : r + 1);

// Escape typed text so it cannot break the row: newline → space, unescaped `|` → `\|`.
export function escapeCell(text) {
  return String(text || "").replace(/\r?\n/g, " ").replace(/(\\*)\|/g, (m, bs) => (bs.length % 2 ? m : bs + "\\|"));
}

// Padding around a cell's content, captured when a cell gains focus and reused for the whole edit session.
// Reusing it (instead of re-deriving from the current text) is what keeps a just-typed trailing space:
// re-deriving would treat the user's space as padding and swallow it (Atomic Editor issue #18).
export function cellPads(line, col) {
  const segs = splitCells(line);
  const seg = segs[col];
  if (!seg) return { left: " ", right: " " };
  const t = String(line).slice(seg.from, seg.to);
  if (!t.trim()) {
    // Empty cell: keep `||` tight; otherwise one space on the left, the rest (at least one) on the right.
    if (!t) return { left: "", right: "" };
    const left = t.startsWith(" ") ? " " : "";
    return { left, right: t.slice(left.length) || " " };
  }
  return { left: t.match(/^\s*/)[0], right: t.match(/\s*$/)[0] };
}

// The minimal change (line offsets) that sets cell `col` of `line` to `text`, keeping `pads`.
// Returns { from, to, insert } or null when nothing changes. A missing trailing cell is appended.
export function cellEdit(line, col, text, pads = cellPads(line, col)) {
  const s = String(line);
  const segs = splitCells(s);
  const body = pads.left + escapeCell(text) + pads.right;
  if (col >= segs.length) {
    // Row is shorter than the header: append the missing cells.
    const trimmedEnd = s.replace(/\s+$/, "");
    let insert = trimmedEnd.endsWith("|") && !escapedAt(trimmedEnd, trimmedEnd.length - 1) ? "" : " |";
    for (let c = segs.length; c <= col; c++) insert += (c === col ? body : "  ") + "|";
    return { from: trimmedEnd.length, to: s.length, insert };
  }
  const seg = segs[col];
  const old = s.slice(seg.from, seg.to);
  if (old === body) return null;
  // Trim the common prefix/suffix so undo history and diffs stay small.
  let p = 0;
  while (p < old.length && p < body.length && old[p] === body[p]) p++;
  let q = 0;
  while (q < old.length - p && q < body.length - p && old[old.length - 1 - q] === body[body.length - 1 - q]) q++;
  return { from: seg.from + p, to: seg.to - q, insert: body.slice(p, body.length - q) };
}

// A new empty body row for a table with `cols` columns.
export function emptyRow(cols) {
  return "|" + "  |".repeat(cols);
}

// ---------------------------------------------------------------- row / column structure edits
// All functions take the table's lines (header, delimiter, body rows — exactly the table, no more) and
// return changes as [{ from, to, insert }] in offsets relative to the table start, with lines joined by a
// single line break (CodeMirror counts every line break as one position, whatever the separator is).
// Row edits touch only that row's line. Column edits insert or remove just one cell segment per row and keep
// every other byte (padding, alignment colons, escaped `\|`). Rows shorter than the column are left alone:
// their missing cells are already empty.

const lineStarts = (lines) => {
  const out = [];
  let at = 0;
  for (const l of lines) { out.push(at); at += l.length + 1; }
  return out;
};

// Insert an empty body row above/below logical row `row` (0 = header; nothing goes above the header).
// Returns { changes, row } where `row` is the new row's logical index, or null. The new row gets the neighbour
// row's leading whitespace (a table inside a list item stays inside it). Line breaks are written as "\n" —
// the editor converts them to the document's own separator.
export function insertRow(lines, row, below) {
  const cols = splitCells(lines[0]).length;
  if (!cols || row < 0 || (!below && row === 0)) return null;
  const k = row === 0 ? 1 : rowLine(row);
  if (k >= lines.length) return null;
  const starts = lineStarts(lines);
  const fresh = lines[k].match(/^[ \t]*/)[0] + emptyRow(cols);
  if (below) {
    const at = starts[k] + lines[k].length;
    return { changes: [{ from: at, to: at, insert: "\n" + fresh }], row: row + 1 };
  }
  return { changes: [{ from: starts[k], to: starts[k], insert: fresh + "\n" }], row };
}

// Delete body row `row` (≥ 1). The header cannot be deleted; the last body row can (the header stays).
// Returns { changes, row } where `row` is the neighbour to focus afterwards.
export function deleteRow(lines, row) {
  const k = rowLine(row);
  if (row < 1 || k >= lines.length) return null;
  const starts = lineStarts(lines);
  const bodyRows = lines.length - 2;
  if (k < lines.length - 1) return { changes: [{ from: starts[k], to: starts[k + 1], insert: "" }], row };
  // Last line of the table: take the line break before it, so the text after the table keeps its own.
  return { changes: [{ from: starts[k] - 1, to: starts[k] + lines[k].length, insert: "" }], row: bodyRows > 1 ? row - 1 : 0 };
}

const hasUnescapedPipe = (s) => splitCells(s).length > 0;

// Insert an empty column left/right of column `col`. The new delimiter cell is ` --- `.
export function insertColumn(lines, col, right) {
  const cols = splitCells(lines[0]).length;
  if (col < 0 || col >= cols) return null;
  const starts = lineStarts(lines);
  const changes = [];
  lines.forEach((s, k) => {
    const segs = splitCells(s);
    if (segs.length <= col) return; // short row: the new column is implicitly empty there
    const cell = k === 1 ? " --- " : "  ";
    const seg = segs[col];
    let at, insert;
    if (right) {
      at = seg.to;
      const last = col === segs.length - 1, trailingPipe = seg.to < s.length;
      insert = last && !trailingPipe ? "|" + cell + "|" : "|" + cell;
    } else {
      at = seg.from;
      const leadingPipe = segs[0].from > 0;
      insert = col === 0 && !leadingPipe ? "|" + cell + "|" : cell + "|";
    }
    changes.push({ from: starts[k] + at, to: starts[k] + at, insert });
  });
  return { changes, col: right ? col + 1 : col };
}

// Delete column `col`. Disabled for the only column. Each row loses that cell and one pipe next to it; a row
// that would be left without any pipe keeps the pipe (it must stay a table row).
export function deleteColumn(lines, col) {
  const cols = splitCells(lines[0]).length;
  if (cols < 2 || col < 0 || col >= cols) return null;
  const starts = lineStarts(lines);
  const changes = [];
  lines.forEach((s, k) => {
    const segs = splitCells(s);
    if (segs.length <= col) return;
    const seg = segs[col];
    const trailingPipe = seg.to < s.length;
    // The cell and the pipe after it; for a last cell without a trailing pipe, the pipe before it.
    let [a, b] = trailingPipe ? [seg.from, seg.to + 1] : [seg.from - 1, seg.to];
    if (a < 0 || !hasUnescapedPipe(s.slice(0, a) + s.slice(b))) [a, b] = [seg.from, seg.to];
    if (b > a) changes.push({ from: starts[k] + a, to: starts[k] + b, insert: "" });
  });
  return { changes, col: Math.min(col, cols - 2) };
}
