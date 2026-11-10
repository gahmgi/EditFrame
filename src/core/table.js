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

import { WidgetType, EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { undo, redo, isolateHistory } from "@codemirror/commands";
import { tableAt, rowLine, cellEdit, cellPads, splitCells, cellText, emptyRow, insertRow, deleteRow, insertColumn, deleteColumn } from "./table-model.js";
import { tableFromClipboard, placeTable, singleLine, browserParse } from "./paste.js";
import { isFence } from "./marks.js";
import { efConfig, finePointer } from "./config.js";

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
  return { wrap, model, row, col, line, lines: texts.slice(0, model.end + 1), tableFrom: first.from, tableTo: doc.line(first.number + model.end).to };
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

  td._efFlush = () => { if (composing) { composing = false; commit(); } };
  input.addEventListener("focus", () => {
    const loc = locate(view, td);
    // Padding is captured once per edit session. Re-deriving it from the text after each keystroke would
    // treat a just-typed trailing space as padding and drop it (Atomic Editor issue #18).
    pads = loc ? cellPads(loc.line.text, loc.col) : null;
    showHandle(td);
  });
  input.addEventListener("blur", () => {
    if (composing) commit(); // some IMEs end composition only by blurring
    pads = null;
    composing = false;
    hideHandle(td);
    td.classList.remove("ef-editing");
    renderInline(td.querySelector(".ef-cell-view"), td.dataset.raw || "", view.state.facet(efConfig).scan);
  });
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; commit(); placeHandle(td); });
  input.addEventListener("input", (e) => {
    if (composing || e.isComposing) return;
    commit();
    placeHandle(td); // the cell may have grown; the handle is outside the cell, so this never touches the input
  });
  // Paste into a cell: one line (a cell cannot hold a line break or a tab); `|` is escaped by the commit.
  input.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (text == null || composing || view.state.readOnly) return;
    e.preventDefault();
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
    input.setRangeText(singleLine(text), a, b, "end");
    commit();
    placeHandle(td);
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
    if (mod && e.key === "Enter") { e.preventDefault(); structural(view, td, "rowBelow"); return; }
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
  const br = view.state.lineBreak;
  if (dir < 0) {
    if (loc.tableFrom > 0) view.dispatch({ selection: { anchor: loc.tableFrom - 1 }, scrollIntoView: true });
    else view.dispatch({ changes: { from: 0, insert: br }, selection: { anchor: 0 }, userEvent: "input" });
  } else if (loc.tableTo < doc.length) {
    view.dispatch({ selection: { anchor: loc.tableTo + 1 }, scrollIntoView: true });
  } else {
    view.dispatch({ changes: { from: loc.tableTo, insert: br }, selection: { anchor: loc.tableTo + 1 }, userEvent: "input" });
  }
  view.focus();
}

// Inserted text is written with "\n"; a document that keeps "\r\n" (EditorState.lineSeparator) would otherwise
// get a bare "\n" inside a line instead of a new line. Positions are unaffected: every line break is one position.
export const withLineBreaks = (state, s) => (state.lineBreak === "\n" ? s : s.replace(/\n/g, state.lineBreak));

// A new empty body row after the table's last line (`tableTo`), indented like that line (tables in list items).
export function appendRowSpec(state, tableTo, cols) {
  const last = state.doc.lineAt(tableTo).text;
  const indent = last.match(/^[ \t]*/)[0];
  return { changes: { from: tableTo, insert: withLineBreaks(state, "\n" + indent + emptyRow(cols)) }, userEvent: "input" };
}

function appendRow(view, td, col) {
  if (view.state.readOnly) return;
  const loc = locate(view, td);
  if (!loc) return;
  const rows = loc.model.rows.length;
  view.dispatch(appendRowSpec(view.state, loc.tableTo, loc.model.cols));
  focusCell(view, loc.tableFrom, rows, col);
}

// After a structural change the widget is rebuilt. CodeMirror has already drawn it when dispatch returns, so
// try to focus right away (still inside the user's tap — iOS then keeps the keyboard open); if that cell is not
// there yet, wait for CodeMirror to draw (double rAF) and try again. (On iOS the keyboard may close in the
// fallback: focus outside the original tap is not always honoured.)
function focusCell(view, from, row, col) {
  const attempt = () => {
    for (const wrap of view.dom.querySelectorAll(".ef-table")) {
      let p = -1;
      try { p = view.posAtDOM(wrap); } catch {}
      if (p !== from) continue;
      const target = wrap.querySelector(`[data-row="${row}"][data-col="${col}"]`);
      if (target) { editCell(target); return document.activeElement === inputOf(target); }
      return false;
    }
    return false;
  };
  if (!attempt()) requestAnimationFrame(() => requestAnimationFrame(attempt));
}

// ---------------------------------------------------------------- row / column menu
// One small «⋯» handle per table, shown only while a cell input is focused, opens a short menu. Taps on the
// handle and the menu never take focus from the cell input (mousedown / touchend are cancelled), so the iOS
// keyboard does not drop and come back. Each action is one transaction with its own undo step.

const ACTIONS = {
  rowAbove: (lines, r) => insertRow(lines, r, false),
  rowBelow: (lines, r) => insertRow(lines, r, true),
  colLeft: (lines, r, c) => insertColumn(lines, c, false),
  colRight: (lines, r, c) => insertColumn(lines, c, true),
  rowDelete: (lines, r) => deleteRow(lines, r),
  colDelete: (lines, r, c) => deleteColumn(lines, c),
};
const MENU = [
  ["rowAbove", "위에 줄 넣기"], ["rowBelow", "아래에 줄 넣기"],
  ["colLeft", "왼쪽에 열 넣기"], ["colRight", "오른쪽에 열 넣기"],
  ["rowDelete", "이 줄 지우기"], ["colDelete", "이 열 지우기"],
];
// Which items are unavailable for this cell: nothing goes above the header, the header cannot be deleted,
// and the only column cannot be deleted.
export function disabledActions(row, cols) {
  const off = new Set();
  if (row === 0) { off.add("rowAbove"); off.add("rowDelete"); }
  if (cols < 2) off.add("colDelete");
  return off;
}

// The transaction for one structural edit of the table starting at `tableFrom` whose lines are `lines`:
// { spec, row, col } (the cell to focus afterwards) or null. One transaction, isolated in the undo history.
export function tableEditSpec(state, tableFrom, lines, action, row, col) {
  if (disabledActions(row, splitCells(lines[0]).length).has(action)) return null;
  const res = ACTIONS[action]?.(lines, row, col);
  if (!res || !res.changes.length) return null;
  return {
    spec: {
      changes: res.changes.map((c) => ({ from: tableFrom + c.from, to: tableFrom + c.to, insert: withLineBreaks(state, c.insert) })),
      userEvent: "input.table",
      annotations: isolateHistory.of("full"),
    },
    row: res.row ?? row,
    col: res.col ?? col,
  };
}

function structural(view, td, action) {
  if (view.state.readOnly) return;
  // Windows/Mac IMEs commit a composition properly only on blur, so with a mouse the cell input is blurred
  // first and the new cell focused afterwards. On touch screens focus stays put (blurring would drop the iOS
  // keyboard); a composition still open there is committed by hand before the widget is rebuilt.
  if (finePointer()) inputOf(td)?.blur();
  else td._efFlush?.();
  const loc = locate(view, td);
  if (!loc) return;
  const edit = tableEditSpec(view.state, loc.tableFrom, loc.lines, action, loc.row, loc.col);
  if (!edit) return;
  view.dispatch(edit.spec);
  focusCell(view, loc.tableFrom, edit.row, edit.col);
}

const partsOf = (td) => {
  const wrap = td.closest(".ef-table");
  return wrap && { wrap, handle: wrap.querySelector(".ef-table-handle"), menu: wrap.querySelector(".ef-table-menu") };
};

// Put the handle on the cell's top-right corner (positions relative to the table wrapper).
function placeHandle(td) {
  const p = partsOf(td);
  if (!p || p.handle.hidden) return;
  const w = p.wrap.getBoundingClientRect(), r = td.getBoundingClientRect();
  const x = Math.min(Math.max(r.right - w.left, 16), p.wrap.clientWidth - 16);
  p.handle.style.left = x + "px";
  p.handle.style.top = Math.max(r.top - w.top, 16) + "px";
  if (!p.menu.hidden) placeMenu(p);
}
// The menu is `position: fixed` so the editor's scroll box cannot clip it. It opens below the handle, or above
// it when the bottom of the visible area (above the on-screen keyboard, via visualViewport) is too close.
function placeMenu(p) {
  const h = p.handle.getBoundingClientRect();
  const width = p.menu.offsetWidth, height = p.menu.offsetHeight;
  const vv = window.visualViewport;
  const left = vv ? vv.offsetLeft : 0, top = vv ? vv.offsetTop : 0;
  const right = left + (vv ? vv.width : window.innerWidth), bottom = top + (vv ? vv.height : window.innerHeight);
  const x = Math.max(left + 4, Math.min(h.right - width, right - width - 4));
  let y = h.bottom + 2;
  if (y + height > bottom) y = h.top - 2 - height >= top ? h.top - 2 - height : Math.max(top + 4, bottom - height - 4);
  p.menu.style.left = x + "px";
  p.menu.style.top = y + "px";
}
function showHandle(td) {
  const p = partsOf(td);
  if (!p?.handle) return;
  p.wrap._efCell = td;
  p.handle.hidden = false;
  placeHandle(td);
}
function hideHandle(td) {
  const p = partsOf(td);
  if (!p?.handle || p.wrap._efCell !== td) return;
  p.wrap._efCell = null;
  p.handle.hidden = true;
  closeMenu(p);
}
function closeMenu(p) {
  p.menu.hidden = true;
  p.handle.setAttribute("aria-expanded", "false");
  stopFollowing(p.wrap);
}
function stopFollowing(wrap) {
  if (!wrap._efFollow) return;
  document.removeEventListener("scroll", wrap._efFollow, true);
  window.visualViewport?.removeEventListener("resize", wrap._efFollow);
  wrap._efFollow = null;
}
// Everything a table widget registers outside its own DOM. Runs when CodeMirror drops the widget (structural
// edit, scrolled out of the viewport, document replaced) and when the editor is destroyed.
export function releaseTable(wrap) {
  stopFollowing(wrap);
  wrap.querySelector(".ef-table-menu")?.remove();
  wrap._efCell = null;
}
function toggleMenu(view, wrap) {
  const td = wrap._efCell;
  const p = td && partsOf(td);
  if (!p) return;
  if (!p.menu.hidden) return closeMenu(p);
  const off = disabledActions(Number(td.dataset.row), Number(wrap.dataset.cols));
  for (const b of p.menu.querySelectorAll("button")) b.disabled = off.has(b.dataset.action);
  p.menu.hidden = false;
  p.handle.setAttribute("aria-expanded", "true");
  placeMenu(p);
  // Keep the fixed menu next to the handle while anything scrolls or the keyboard resizes the viewport.
  stopFollowing(wrap);
  wrap._efFollow =() => { if (wrap.isConnected && !p.menu.hidden) placeMenu(p); };
  document.addEventListener("scroll", wrap._efFollow, { capture: true, passive: true });
  window.visualViewport?.addEventListener("resize", wrap._efFollow);
}

// A tap that must not move focus: touchend is cancelled (no synthetic mouse events, no blur of the cell
// input, no click), mousedown is cancelled for the mouse, and the action runs from touchend or click.
export function onTap(el, act) {
  let start = null;
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("touchstart", (e) => { const t = e.touches[0]; start = t && { x: t.clientX, y: t.clientY }; }, { passive: true });
  el.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    const moved = !start || !t || Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10;
    start = null;
    if (moved || e.touches.length) return;
    e.preventDefault();
    act(e);
  });
  el.addEventListener("click", (e) => { e.preventDefault(); act(e); });
}

function buildMenu(view, wrap) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "ef-table-handle";
  handle.hidden = true;
  handle.tabIndex = -1;
  handle.setAttribute("aria-label", "표 편집");
  handle.setAttribute("aria-haspopup", "menu");
  handle.setAttribute("aria-expanded", "false");
  const dot = document.createElement("span");
  dot.textContent = "⋯";
  dot.setAttribute("aria-hidden", "true");
  handle.append(dot);
  onTap(handle, () => toggleMenu(view, wrap));

  const menu = document.createElement("div");
  menu.className = "ef-table-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  for (const [action, label] of MENU) {
    const b = document.createElement("button");
    b.type = "button";
    b.tabIndex = -1;
    b.dataset.action = action;
    b.setAttribute("role", "menuitem");
    b.textContent = label;
    onTap(b, () => {
      const td = wrap._efCell;
      if (b.disabled || !td) return;
      closeMenu(partsOf(td));
      structural(view, td, action);
    });
    menu.append(b);
  }
  return [handle, menu];
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
    // The table scrolls sideways inside its own box; the handle and menu sit outside it so they are not clipped.
    const scroller = document.createElement("div");
    scroller.className = "ef-table-scroll";
    scroller.append(table);
    wrap.dataset.cols = String(this.model.cols);
    wrap.append(scroller);
    if (!this.readOnly) {
      wrap.append(...buildMenu(view, wrap));
      scroller.addEventListener("scroll", () => { if (wrap._efCell) placeHandle(wrap._efCell); }, { passive: true });
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

  destroy(dom) { releaseTable(dom); }
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

// Is `pos` inside a fenced code block (or on a fence line)? Counted from the document start, as the preview does.
export function inFence(state, pos) {
  const n = state.doc.lineAt(pos).number;
  if (isFence(state.doc.line(n).text)) return true;
  let open = false;
  for (let k = 1; k < n; k++) if (isFence(state.doc.line(k).text)) open = !open;
  return open;
}

// The transaction for pasting `clip` ({ html, text }) at the main selection as a GFM table, or null when the
// paste should stay CodeMirror's default: no table on the clipboard, or the caret is in a code block.
export function tablePasteSpec(state, clip, parse = browserParse) {
  const r = state.selection.main, doc = state.doc;
  if (inFence(state, r.from) || inFence(state, r.to)) return null;
  const table = tableFromClipboard(clip, parse);
  if (!table) return null;
  const first = doc.lineAt(r.from), last = doc.lineAt(r.to);
  const p = placeTable(table, {
    before: state.sliceDoc(first.from, r.from),
    after: state.sliceDoc(r.to, last.to),
    prev: first.number > 1 ? doc.line(first.number - 1).text : null,
    next: last.number < doc.lines ? doc.line(last.number + 1).text : null,
  });
  return { changes: { from: r.from, to: r.to, insert: withLineBreaks(state, p.text) }, selection: { anchor: r.from + p.caret }, userEvent: "input.paste", scrollIntoView: true };
}

// Ctrl/⌘+Shift+V means "paste as plain text": remember it from the keydown just before the paste event.
const plainPasteAt = new WeakMap();

// Paste in the editor body: a table from a spreadsheet or web page (HTML <table>, else TSV) becomes a GFM table
// on its own lines. Anything else goes to CodeMirror's default paste. Cell inputs handle their own paste.
export const pasteTables = EditorView.domEventHandlers({
  keydown(e, view) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "v" || e.key === "V")) plainPasteAt.set(view, Date.now());
    return false;
  },
  paste(e, view) {
    const plain = Date.now() - (plainPasteAt.get(view) || 0) < 1000;
    plainPasteAt.delete(view);
    if (plain || view.state.readOnly || e.target.closest?.(".ef-table")) return false;
    const dt = e.clipboardData;
    if (!dt) return false;
    const spec = tablePasteSpec(view.state, { html: dt.getData("text/html"), text: dt.getData("text/plain") }, browserParse);
    if (!spec) return false;
    e.preventDefault();
    view.dispatch(spec);
    return true;
  },
});
