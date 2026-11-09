// GFM table widget — the table is shown as a real <table>; a cell is edited in a native <input>.
//
// Design (cell-precise, text stays the source of truth):
//   - The whole table source range is replaced by one block widget. CodeMirror ignores events and DOM
//     mutations inside widgets, so nothing in a cell goes through CodeMirror's input handling.
//   - Each cell shows its rendered text (`**굵게**` → bold) in a <span>. Tapping it swaps in a native
//     <input type="text"> holding the raw cell markdown. Native form controls are the most IME-stable
//     editing surface on iOS Safari: no decorations, no DOM rewrites, the OS owns the composition.
//     (A contenteditable cell — Atomic Editor's approach — still exposes the cell to DOM rebuilding.)
//   - Typing dispatches a change for **that cell's bytes only** (table-model.js cellEdit). Other rows, the
//     alignment row and padding are never rewritten.
//   - IME: nothing is dispatched while composing; one commit runs at compositionend.
//   - `updateDOM` refreshes every cell from the document but never touches the active input.
//
// Pattern credit: Atomic Editor's table widget (MIT) — block widget over the table range, composition
// suppression, Tab/Enter cell navigation, double-rAF focus after a structural change, Backspace after a
// table selects it. See THIRD_PARTY_NOTICES.md.

import { WidgetType } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { undo, redo } from "@codemirror/commands";
import { tableAt, rowLine, cellEdit, cellPads, splitCells, cellText, emptyRow } from "./table-model.js";
import { efConfig } from "./config.js";

// Render a cell's markdown as inline-styled DOM (markers removed) using the editor's scanner.
function renderInline(target, raw, scan) {
  const sc = scan(raw);
  const hidden = [...sc.ops, ...sc.inline.flatMap((e) => e.hide)];
  const cuts = new Set([0, raw.length]);
  for (const e of sc.inline) { cuts.add(e.from); cuts.add(e.to); }
  for (const [a, b] of hidden) { cuts.add(a); cuts.add(b); }
  const pts = [...cuts].filter((p) => p >= 0 && p <= raw.length).sort((a, b) => a - b);
  const frag = document.createDocumentFragment();
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    if (hidden.some(([x, y]) => x <= a && b <= y)) continue;
    const text = raw.slice(a, b);
    const covering = sc.inline.filter((e) => e.from <= a && b <= e.to);
    if (!covering.length) { frag.append(text); continue; }
    const span = document.createElement("span");
    span.className = covering.map((e) => classFor(e)).join(" ");
    const link = covering.find((e) => e.href || e.id);
    if (link) setLinkAttrs(span, link);
    span.textContent = text;
    frag.append(span);
  }
  target.replaceChildren(frag);
}

export function classFor(el) {
  switch (el.type) {
    case "bold": return "ef-bold";
    case "italic": return "ef-italic";
    case "underline": return "ef-u";
    case "strike": return "ef-strike";
    case "code": return "ef-code-inline";
    case "mdlink": case "url": return "ef-link";
    default: return el.className || `ef-${el.type}`;
  }
}

export function setLinkAttrs(node, el) {
  node.setAttribute("data-ef-type", el.type);
  if (el.href) node.setAttribute("data-ef-href", el.href);
  if (el.id) node.setAttribute("data-ef-id", el.id);
}

// Where is this cell in the current document? Positions shift while typing, so this is resolved on
// every use from the widget's DOM position — never cached.
function locate(view, td) {
  const wrap = td.closest(".ef-table");
  if (!wrap) return null;
  let pos;
  try { pos = view.posAtDOM(wrap); } catch { return null; }
  if (pos < 0) return null;
  const doc = view.state.doc;
  const first = doc.lineAt(pos);
  const texts = [];
  for (let n = first.number; n <= doc.lines; n++) {
    const t = doc.line(n).text;
    texts.push(t);
    if (n > first.number + 1 && (!t.trim() || !t.includes("|"))) break;
  }
  const model = tableAt(texts, 0);
  if (!model) return null;
  const row = Number(td.dataset.row), col = Number(td.dataset.col);
  const lineNo = first.number + rowLine(row);
  if (lineNo > first.number + model.end) return null;
  const line = doc.line(lineNo);
  return { wrap, model, row, col, line, tableFrom: first.from, tableTo: doc.line(first.number + model.end).to };
}

const inputOf = (td) => td.querySelector(".ef-cell-input");
const isEditing = (td) => td.classList.contains("ef-editing");

// Swap the cell into edit mode and focus its input (must run inside the user's tap for iOS to open
// the keyboard — focus() outside a user gesture is ignored there).
function editCell(td, caret = "end") {
  const input = inputOf(td);
  if (!input) return;
  if (!isEditing(td)) {
    input.value = td.dataset.raw || "";
    td.classList.add("ef-editing");
  }
  input.focus({ preventScroll: true });
  const at = caret === "start" ? 0 : input.value.length;
  try { input.setSelectionRange(at, at); } catch {}
}

function attachCell(view, td) {
  const input = inputOf(td);
  let composing = false;
  let pads = null;

  const commit = () => {
    if (view.state.readOnly) return;
    const live = input.value;
    td.dataset.raw = live;
    const loc = locate(view, td);
    if (!loc) return;
    if (!pads) pads = cellPads(loc.line.text, loc.col);
    const ch = cellEdit(loc.line.text, loc.col, live, pads);
    if (!ch) return;
    view.dispatch({
      changes: { from: loc.line.from + ch.from, to: loc.line.from + ch.to, insert: ch.insert },
      userEvent: "input.type.cell",
    });
  };

  // Re-read this cell from the document (undo/redo go through CodeMirror, not the input).
  const resync = () => {
    const loc = locate(view, td);
    if (!loc) return;
    const seg = splitCells(loc.line.text)[loc.col];
    td.dataset.raw = seg ? cellText(loc.line.text, seg) : "";
    input.value = td.dataset.raw;
    pads = cellPads(loc.line.text, loc.col);
  };

  input.addEventListener("focus", () => {
    const loc = locate(view, td);
    // Padding is captured once per edit session. Re-deriving it from the text after each keystroke would
    // treat a just-typed trailing space as padding and drop it (Atomic Editor issue #18).
    pads = loc ? cellPads(loc.line.text, loc.col) : null;
  });
  input.addEventListener("blur", () => {
    if (composing) commit(); // some IMEs end composition only by blurring
    pads = null;
    composing = false;
    td.classList.remove("ef-editing");
    renderInline(td.querySelector(".ef-cell-view"), td.dataset.raw || "", view.state.facet(efConfig).scan);
  });
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; commit(); });
  input.addEventListener("input", (e) => {
    if (composing || e.isComposing) return;
    commit();
  });
  input.addEventListener("keydown", (e) => {
    // Never act on keys that belong to an active composition (Enter that commits a syllable, etc.).
    if (e.isComposing || e.keyCode === 229 || composing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
      e.preventDefault();
      (e.key === "y" || e.shiftKey ? redo : undo)(view);
      resync();
      return;
    }
    if (e.key === "Tab") { e.preventDefault(); moveFocus(view, td, e.shiftKey ? -1 : 1); }
    else if (e.key === "Enter") { e.preventDefault(); moveRow(view, td, e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); leaveTable(view, td, 1); }
    else if (e.key === "ArrowUp" && Number(td.dataset.row) === 0) { e.preventDefault(); leaveTable(view, td, -1); }
    else if (e.key === "ArrowDown" && !td.parentElement.nextElementSibling && td.tagName === "TD") { e.preventDefault(); leaveTable(view, td, 1); }
  });
}

function cellsOf(wrap) {
  return [...wrap.querySelectorAll("th, td")];
}

function moveFocus(view, td, dir) {
  const cells = cellsOf(td.closest(".ef-table"));
  const next = cells.indexOf(td) + dir;
  if (next < 0) return leaveTable(view, td, -1);
  if (next >= cells.length) return appendRow(view, td, 0);
  editCell(cells[next]);
}

function moveRow(view, td, dir) {
  const wrap = td.closest(".ef-table");
  const row = Number(td.dataset.row) + dir, col = Number(td.dataset.col);
  if (row < 0) return leaveTable(view, td, -1);
  const target = wrap.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  if (target) return editCell(target);
  appendRow(view, td, col);
}

// Put the editor caret on the line before/after the table (adding an empty line at the document edge
// so the caret never lands on the table's own line, where typing would extend the last row).
function leaveTable(view, td, dir) {
  const loc = locate(view, td);
  if (!loc) return;
  const doc = view.state.doc;
  inputOf(td)?.blur();
  if (dir < 0) {
    if (loc.tableFrom > 0) view.dispatch({ selection: { anchor: loc.tableFrom - 1 }, scrollIntoView: true });
    else view.dispatch({ changes: { from: 0, insert: "\n" }, selection: { anchor: 0 }, userEvent: "input" });
  } else if (loc.tableTo < doc.length) {
    view.dispatch({ selection: { anchor: loc.tableTo + 1 }, scrollIntoView: true });
  } else {
    view.dispatch({ changes: { from: loc.tableTo, insert: "\n" }, selection: { anchor: loc.tableTo + 1 }, userEvent: "input" });
  }
  view.focus();
}

function appendRow(view, td, col) {
  if (view.state.readOnly) return;
  const loc = locate(view, td);
  if (!loc) return;
  const rows = loc.model.rows.length;
  view.dispatch({ changes: { from: loc.tableTo, insert: "\n" + emptyRow(loc.model.cols) }, userEvent: "input" });
  const from = loc.tableFrom;
  // The row count changed, so the widget is rebuilt. Wait for CodeMirror to draw it, then focus.
  // (On iOS the keyboard may close here: focus outside the original tap is not always honoured.)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const wrap of view.dom.querySelectorAll(".ef-table")) {
      let p = -1;
      try { p = view.posAtDOM(wrap); } catch {}
      if (p !== from) continue;
      const target = wrap.querySelector(`[data-row="${rows}"][data-col="${col}"]`);
      if (target) editCell(target);
      return;
    }
  }));
}

export class TableWidget extends WidgetType {
  constructor(model, readOnly) {
    super();
    this.model = model; // { align, cols, rows } — rows[0] is the header
    this.readOnly = readOnly;
  }

  get shape() {
    return `${this.readOnly ? "ro" : "rw"}|${this.model.cols}|${this.model.rows.length}|${this.model.align.join(",")}`;
  }

  eq(o) {
    if (o.shape !== this.shape) return false;
    const a = this.model.rows, b = o.model.rows;
    for (let r = 0; r < a.length; r++) for (let c = 0; c < a[r].length; c++) if (a[r][c] !== b[r][c]) return false;
    return true;
  }

  // Same shape, different text: refresh cells in place. A cell being edited is left alone — its input
  // is the live source and already holds what the user typed.
  updateDOM(dom, view) {
    if (dom.dataset.shape !== this.shape) return false;
    const scan = view.state.facet(efConfig).scan;
    for (const td of cellsOf(dom)) {
      const raw = this.model.rows[Number(td.dataset.row)]?.[Number(td.dataset.col)] ?? "";
      if (isEditing(td) || td.dataset.raw === raw) continue;
      td.dataset.raw = raw;
      renderInline(td.querySelector(".ef-cell-view"), raw, scan);
    }
    return true;
  }

  toDOM(view) {
    const scan = view.state.facet(efConfig).scan;
    const wrap = document.createElement("div");
    wrap.className = "ef-table";
    wrap.dataset.shape = this.shape;
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    this.model.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      for (let c = 0; c < this.model.cols; c++) {
        const td = document.createElement(r === 0 ? "th" : "td");
        if (this.model.align[c]) td.style.textAlign = this.model.align[c];
        td.dataset.row = String(r);
        td.dataset.col = String(c);
        td.dataset.raw = row[c] ?? "";
        const viewEl = document.createElement("span");
        viewEl.className = "ef-cell-view";
        renderInline(viewEl, td.dataset.raw, scan);
        td.append(viewEl);
        if (!this.readOnly) {
          const input = document.createElement("input");
          input.type = "text";
          input.className = "ef-cell-input";
          input.setAttribute("aria-label", r === 0 ? `표 머리글 ${c + 1}열` : `표 ${r}행 ${c + 1}열`);
          input.spellcheck = false;
          input.setAttribute("autocomplete", "off");
          td.append(input);
          attachCell(view, td);
        }
        tr.append(td);
      }
      (r === 0 ? thead : tbody).append(tr);
    });
    table.append(thead, tbody);
    wrap.append(table);
    if (!this.readOnly) {
      // Tap a cell → edit it. Runs on click (a user gesture) so iOS opens the keyboard.
      wrap.addEventListener("mousedown", (e) => {
        if (!e.target.closest?.(".ef-cell-input")) e.preventDefault();
      });
      wrap.addEventListener("click", (e) => {
        const td = e.target.closest?.("th, td");
        if (!td || e.target.closest(".ef-cell-input")) return;
        editCell(td);
      });
    }
    return wrap;
  }

  ignoreEvent() { return true; }
}

// Backspace on the line right after a table (caret at line start) selects the whole table instead of
// merging that line into the last row. A second Backspace deletes the selected table.
export function backspaceAfterTable(tablesOf) {
  return (view) => {
    const { state } = view;
    const r = state.selection.main;
    if (!r.empty || state.readOnly) return false;
    const line = state.doc.lineAt(r.head);
    if (r.head !== line.from || line.number === 1) return false;
    const t = tablesOf(state).find((t) => t.to === line.from - 1);
    if (!t) return false;
    view.dispatch({ selection: EditorSelection.range(t.from, t.to) });
    return true;
  };
}
