// Keyboard behaviour that makes hidden markers usable.

import { Prec, EditorSelection } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { continueList, scanBlock } from "./marks.js";
import { toggleBoldSelection, toggleUnderlineSelection } from "./format.js";
import { backspaceAfterTable } from "./table.js";
import { tablesOf } from "./preview.js";

export const INDENT_UNIT = "  ";

// Line-wise indent / outdent by two spaces. Empty lines are left alone inside a multi-line selection,
// but a bare caret on an empty line still indents (otherwise "Tab does nothing").
export function shiftLines(view, dir) {
  const { state } = view;
  if (state.readOnly) return false;
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number, last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      if (dir > 0) {
        if (line.length || r.empty) changes.push({ from: line.from, insert: INDENT_UNIT });
      } else {
        let k = 0;
        while (k < INDENT_UNIT.length && line.text[k] === " ") k++;
        if (k) changes.push({ from: line.from, to: line.from + k });
      }
    }
  }
  if (changes.length) view.dispatch({ changes, userEvent: dir > 0 ? "input.indent" : "delete.dedent" });
  return true;
}

// Ctrl/⌘+B · U. Mixed selections are left untouched (noop).
function formatWith(fn) {
  return (view) => {
    const { state } = view;
    if (state.readOnly) return false;
    const r = state.selection.main;
    // Context is the surrounding line(s): inline marks never span lines in this editor.
    const res = fn(state.sliceDoc(r.from, r.to), {
      before: state.sliceDoc(state.doc.lineAt(r.from).from, r.from),
      after: state.sliceDoc(r.to, state.doc.lineAt(r.to).to),
    });
    if (res.noop) return true;
    const start = r.from - (res.dropBefore || 0), end = r.to + (res.dropAfter || 0);
    view.dispatch({
      changes: { from: start, to: end, insert: res.text },
      selection: EditorSelection.range(start + res.caretStart, start + res.caretEnd),
      userEvent: "input.format",
    });
    return true;
  };
}

// Enter continues a list (the marker is hidden, so a new line must get it automatically).
// Enter on an empty item ends the list.
export function enterList(view) {
  const { state } = view;
  if (state.readOnly) return false;
  const r = state.selection.main;
  if (!r.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(r.head);
  const res = continueList(line.text, r.head - line.from);
  if (!res) return false;
  if (res.clear) {
    view.dispatch({ changes: { from: line.from + res.clear[0], to: line.from + res.clear[1] }, userEvent: "delete" });
  } else {
    view.dispatch(state.replaceSelection(res.insert), { scrollIntoView: true, userEvent: "input" });
  }
  return true;
}

// Backspace right after a hidden marker (before the first content letter) removes the whole marker.
// Deleting an invisible `- [ ] ` one character at a time leaves half-states (`- [ `) the user cannot see.
export function backspaceMarker(view) {
  const { state } = view;
  if (state.readOnly) return false;
  const r = state.selection.main;
  if (!r.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(r.head);
  const b = scanBlock(line.text);
  if (!b || r.head !== line.from + b.to || b.to <= b.from) return false;
  view.dispatch({ changes: { from: line.from + b.from, to: line.from + b.to }, userEvent: "delete.backward" });
  return true;
}

export const editKeys = Prec.high(keymap.of([
  { key: "Enter", run: enterList },
  { key: "Backspace", run: backspaceAfterTable(tablesOf) },
  { key: "Backspace", run: backspaceMarker },
  { key: "Tab", run: (v) => shiftLines(v, 1), shift: (v) => shiftLines(v, -1) },
  { key: "Mod-b", run: formatWith(toggleBoldSelection) },
  { key: "Mod-u", run: formatWith(toggleUnderlineSelection) },
]));
