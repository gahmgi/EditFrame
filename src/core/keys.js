// Keyboard behaviour that makes hidden markers usable.

import { Prec, EditorSelection } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { continueList, scanBlock } from "./marks.js";
import { toggleBoldSelection, toggleStrikeSelection, toggleUnderlineSelection } from "./format.js";
import { backspaceAfterTable, withLineBreaks } from "./table.js";
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

// Where formatting starts: past the line marker when a one-line selection begins on it.
export function formatStart(state, from, to) {
  const line = state.doc.lineAt(from);
  if (to > line.to) return from; // multi-line selection: leave as is
  const b = scanBlock(line.text);
  const content = b ? line.from + b.to : line.from;
  return from < content && to > content ? content : from;
}

// Ctrl/⌘+B · U, Alt+Shift+5 (strike). Mixed selections are left untouched (noop).
function formatWith(fn) {
  return (view) => {
    const { state } = view;
    if (state.readOnly) return false;
    let r = state.selection.main;
    // A selection that starts on a line marker (`- [ ] `, `- `, `## `…) formats the content only: wrapping the
    // marker would turn `- [ ] task` into `~~- [ ] task~~`, which is no longer a task.
    const from = formatStart(state, r.from, r.to);
    // Context is the surrounding line(s): inline marks never span lines in this editor.
    const res = fn(state.sliceDoc(from, r.to), {
      before: state.sliceDoc(state.doc.lineAt(from).from, from),
      after: state.sliceDoc(r.to, state.doc.lineAt(r.to).to),
    });
    if (res.noop) return true;
    const start = from - (res.dropBefore || 0), end = r.to + (res.dropAfter || 0);
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
    view.dispatch(state.replaceSelection(withLineBreaks(state, res.insert)), { scrollIntoView: true, userEvent: "input" });
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
  // Alt+Shift+5 as in Google Docs. Ctrl/⌘+Shift+X was too close to Ctrl+X (cut). CodeMirror matches the
  // shifted digit through its keyCode fallback, so "%" on US layouts and other layouts both work.
  { key: "Alt-Shift-5", run: formatWith(toggleStrikeSelection) },
]));
