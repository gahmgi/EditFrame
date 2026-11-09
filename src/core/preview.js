// Live preview: decorations that hide markdown syntax the caret is not touching.
// The document text is never changed here — only how it is drawn.

import { StateField, StateEffect } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, ViewPlugin } from "@codemirror/view";
import { isFence, isHr, touches, revealsPrefix, scanBlock, toggledCheckChar, shortUrl } from "./marks.js";
import { tableAt } from "./table-model.js";
import { TableWidget, classFor, setLinkAttrs } from "./table.js";
import { efConfig } from "./config.js";

// ---------------------------------------------------------------- widgets

class CheckboxWidget extends WidgetType {
  constructor(checked) { super(); this.checked = checked; }
  eq(o) { return o.checked === this.checked; }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "ef-lead ef-box";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.tabIndex = -1;
    input.setAttribute("aria-label", this.checked ? "완료 취소" : "완료로 표시");
    wrap.append(input);
    return wrap;
  }
  ignoreEvent() { return false; } // clicks are handled by checkboxClicks below
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "ef-lead ef-bullet";
    s.textContent = "•";
    s.setAttribute("aria-hidden", "true");
    return s;
  }
}

class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "ef-hr";
    s.setAttribute("aria-hidden", "true");
    return s;
  }
}

class UrlWidget extends WidgetType {
  constructor(href, label) { super(); this.href = href; this.label = label; }
  eq(o) { return o.href === this.href && o.label === this.label; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "ef-link";
    s.textContent = this.label;
    s.title = this.href;
    setLinkAttrs(s, { type: "url", href: this.href });
    return s;
  }
  ignoreEvent() { return false; }
}

// ---------------------------------------------------------------- decorations

const HIDE = Decoration.replace({});
const MUTED = Decoration.mark({ class: "ef-mark" });
const markCache = new Map();
function markFor(el) {
  const cls = classFor(el);
  if (!el.href && !el.id) {
    if (!markCache.has(cls)) markCache.set(cls, Decoration.mark({ class: cls }));
    return markCache.get(cls);
  }
  const attributes = { "data-ef-type": el.type };
  if (el.href) attributes["data-ef-href"] = el.href;
  if (el.id) attributes["data-ef-id"] = el.id;
  return Decoration.mark({ class: cls, attributes });
}
const lineDeco = new Map(); // reuse identical line decorations (same object → CodeMirror leaves the DOM alone)
function lineClass(cls, style = "") {
  const k = cls + "|" + style;
  if (!lineDeco.has(k)) lineDeco.set(k, Decoration.line(style ? { class: cls, attributes: { style } } : { class: cls }));
  return lineDeco.get(k);
}
// List lines: indent with padding instead of spaces, and hang wrapped lines under the first content letter.
const LEAD = 1.6; // em — must match the .ef-lead width in theme.js
const listStyle = (level) => `padding-left:${(level * 1.5 + LEAD).toFixed(2)}em;text-indent:-${LEAD}em`;
const orderedStyle = (level) => `padding-left:${(level * 1.5).toFixed(2)}em`;

// Build every decoration for the document. A full pass is fine for notes of a few hundred lines.
// `key` summarises which markers are revealed — when only the caret moved and the key is unchanged,
// the decorations are kept as they are.
function build(state) {
  const doc = state.doc;
  const scan = state.facet(efConfig).scan;
  const readOnly = state.readOnly;
  const sels = state.selection.ranges.map((r) => ({ from: r.from, to: r.to }));
  const out = [];
  const atomic = [];
  const tables = [];
  const key = [];
  const texts = [];
  for (const t of doc.iterLines()) texts.push(t);
  let fenced = false;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = texts[i - 1];
    if (isFence(text)) {
      fenced = !fenced;
      out.push(lineClass("ef-codeblock ef-fence").range(line.from));
      continue;
    }
    if (fenced) { out.push(lineClass("ef-codeblock").range(line.from)); continue; }

    if (text.includes("|")) {
      const t = tableAt(texts, i - 1);
      if (t) {
        const from = line.from, to = doc.line(t.end + 1).to;
        out.push(Decoration.replace({ widget: new TableWidget(t, readOnly), block: true }).range(from, to));
        atomic.push(HIDE.range(from, to));
        tables.push({ from, to });
        i = t.end + 1;
        continue;
      }
    }

    const sc = scan(text);
    // Always-hidden matches (preset markers): hide the whole line when that is all it has.
    if (sc.opOnly) {
      const from = i > 1 ? doc.line(i - 1).to : line.from;
      if (line.to > from) { out.push(HIDE.range(from, line.to)); atomic.push(HIDE.range(from, line.to)); }
      continue;
    }
    for (const [a, b] of sc.ops) {
      out.push(HIDE.range(line.from + a, line.from + b));
      atomic.push(HIDE.range(line.from + a, line.from + b));
    }

    if (isHr(text)) {
      const shown = touches(sels, line.from, line.to);
      key.push(shown ? 1 : 0);
      out.push(lineClass("ef-hr-line").range(line.from));
      if (!shown && line.to > line.from) out.push(Decoration.replace({ widget: new HrWidget() }).range(line.from, line.to));
      else out.push(MUTED.range(line.from, line.to));
      continue;
    }

    const blk = sc.block;
    let inlineFrom = 0;
    if (blk) {
      inlineFrom = blk.to;
      const shown = revealsPrefix(sels, line.from, line.from + blk.to);
      key.push(shown ? 1 : 0);
      if (blk.type === "heading") {
        out.push(lineClass(`ef-h ef-h${Math.min(blk.level, 4)}`).range(line.from));
        out.push((shown ? MUTED : HIDE).range(line.from, line.from + blk.to));
      } else if (blk.type === "ordered") {
        out.push(lineClass("ef-li ef-ol", orderedStyle(blk.level)).range(line.from));
        out.push(MUTED.range(line.from + blk.from, line.from + blk.to));
      } else if (blk.type === "quote") {
        out.push(lineClass("ef-quote").range(line.from));
        if (blk.to > blk.from) out.push((shown ? MUTED : HIDE).range(line.from + blk.from, line.from + blk.to));
      } else {
        const cls = blk.type === "task" && blk.checked ? "ef-li ef-done" : "ef-li";
        out.push(lineClass(cls, listStyle(blk.level)).range(line.from));
        if (shown) {
          if (blk.to > blk.from) out.push(MUTED.range(line.from + blk.from, line.from + blk.to));
        } else {
          // Replace the indentation too — the line padding draws the indent.
          const w = blk.type === "task" ? new CheckboxWidget(blk.checked) : new BulletWidget();
          out.push(Decoration.replace({ widget: w }).range(line.from, line.from + blk.to));
        }
      }
    }

    for (const el of sc.inline) {
      if (el.from < inlineFrom) continue; // never overlap the line-leading marker
      const from = line.from + el.from, to = line.from + el.to;
      const shown = touches(sels, from, to);
      if (el.hide.length) key.push(shown ? 1 : 0);
      if (el.type === "url") {
        const label = shortUrl(el.href);
        if (label) {
          key.push(shown ? 1 : 0);
          if (!shown) {
            out.push(Decoration.replace({ widget: new UrlWidget(el.href, label) }).range(from, to));
            continue;
          }
        }
      }
      // Style only the text between the markers (a revealed link target is not painted as a link).
      const body = el.hide.length ? [from + (el.hide[0][1] - el.hide[0][0]), to - (el.hide[el.hide.length - 1][1] - el.hide[el.hide.length - 1][0])] : [from, to];
      if (body[1] > body[0]) out.push(markFor(el).range(body[0], body[1]));
      for (const [a, b] of el.hide) {
        if (b > a) out.push((shown ? MUTED : HIDE).range(line.from + a, line.from + b));
      }
    }
  }
  return {
    deco: Decoration.set(out, true),
    atomic: Decoration.set(atomic, true),
    tables,
    key: key.join(""),
  };
}

// How long the caret neighbourhood stays "hot" after a typing change (ms). See the IME guard below.
export const HOT_MS = 400;

// Recompute the decorations deferred while composing or typing.
const refresh = StateEffect.define();
// Composition started (from the DOM event). Some paths deliver composing input without the
// `input.type.compose` user event; this flag makes the guard independent of that tag.
const composeStart = StateEffect.define();

const lineOfHead = (state) => state.doc.lineAt(state.selection.main.head).number;
const frozenAs = (v, tr, frozen) => ({
  deco: v.deco.map(tr.changes), atomic: v.atomic.map(tr.changes), tables: mapTables(v.tables, tr.changes),
  key: v.key, frozen, hotLine: lineOfHead(tr.state),
});
const fresh = (state) => ({ ...build(state), frozen: false, hotLine: 0 });

// ⚠️ IME guard — the heart of this field. Two triggers, one rule:
//    while "frozen", decorations are **never recomputed**; the existing set is only mapped through each
//    change, so no widget or hidden range next to the text being entered is added, removed or moved in the
//    DOM. Rewriting the DOM around in-progress Hangul makes iOS Safari / Windows Chrome duplicate or drop
//    jamo.
//
//    1. "compose" — the transaction is `input.type.compose`, or a compositionstart was seen and no refresh
//       has happened since. Ends at compositionend (or the lost-compositionend fallback).
//    2. "hot" — any typing change (`input.type…` from the DOM, `delete…`). WebKit's Korean IME often sends
//       **no composition events at all**: a syllable arrives as `insertText` and its growth (adding a vowel
//       or final consonant) as `insertReplacementText` replacing the previous character, with
//       isComposing === false. A composition-only guard would not protect that path. The hot window ends
//       HOT_MS after the last typing change, or as soon as the caret leaves the line.
//
//    Recompute happens once, when idle (compositionWatch). Without a doc change, a caret move that reveals
//    nothing new keeps the existing decorations (no needless DOM replacement).
export const preview = StateField.define({
  create(state) { return fresh(state); },
  update(v, tr) {
    if (tr.effects.some((e) => e.is(refresh))) return fresh(tr.state);
    const cell = tr.isUserEvent("input.type.cell"); // table cells are native inputs — not IME-sensitive here
    if (tr.effects.some((e) => e.is(composeStart))) return tr.docChanged ? frozenAs(v, tr, "compose") : { ...v, frozen: "compose" };
    if (tr.isUserEvent("input.type.compose") || (v.frozen === "compose" && tr.docChanged && !cell)) return frozenAs(v, tr, "compose");
    if (tr.docChanged && !cell && (tr.isUserEvent("input.type") || tr.isUserEvent("delete"))) return frozenAs(v, tr, v.frozen === "compose" ? "compose" : "hot");
    if (v.frozen && !tr.docChanged) {
      // Selection-only update while frozen: keep everything, unless a hot caret left its line.
      if (v.frozen === "hot" && tr.selection && lineOfHead(tr.state) !== v.hotLine) return fresh(tr.state);
      return v;
    }
    if (tr.startState.readOnly !== tr.state.readOnly) return fresh(tr.state);
    if (!tr.docChanged && !tr.selection) return v;
    const next = fresh(tr.state);
    if (!tr.docChanged && next.key === v.key) return v;
    return next;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.atomicRanges.of((view) => view.state.field(f).atomic),
  ],
});

function mapTables(tables, changes) {
  return tables.map((t) => ({ from: changes.mapPos(t.from, 1), to: changes.mapPos(t.to, -1) }));
}

export const tablesOf = (state) => state.field(preview, false)?.tables || [];

// Schedules the deferred recompute.
//   - compositionend: short delay so CodeMirror finishes its own compositionend handling; if the next
//     composition already started (Hangul composes letter after letter), skip — it comes again later.
//   - hot typing: HOT_MS after the last typing change.
//   - lost compositionend (seen after predictive-text taps / blur on iOS): if the field still says
//     "compose" while the view is not composing, refresh after 300 ms.
// Events from table cells are ignored: cells are native inputs outside CodeMirror's text.
export const compositionWatch = ViewPlugin.fromClass(class {
  constructor(view) { this.view = view; this.t = 0; }
  schedule(delay) {
    clearTimeout(this.t);
    this.t = setTimeout(() => {
      if (this.view.composing) return;
      if (this.view.state.field(preview, false)?.frozen) this.view.dispatch({ effects: refresh.of(null) });
    }, delay);
  }
  update(u) {
    const frozen = u.state.field(preview, false)?.frozen;
    if (frozen === "hot" && u.docChanged) this.schedule(HOT_MS);
    else if (frozen === "compose" && !u.view.composing) this.schedule(300);
  }
  destroy() { clearTimeout(this.t); }
}, {
  eventHandlers: {
    compositionstart(e) {
      if (e.target.closest?.(".ef-table")) return;
      clearTimeout(this.t);
      if (this.view.state.field(preview, false)?.frozen !== "compose") {
        // Safe: the decoration set is unchanged, so CodeMirror does not touch the DOM.
        queueMicrotask(() => this.view.dispatch({ effects: composeStart.of(null) }));
      }
    },
    compositionend(e) {
      if (e.target.closest?.(".ef-table")) return;
      this.schedule(30);
    },
  },
});

// Toggle the checkbox on the line containing `pos`: changes exactly one character (`[ ]` ↔ `[x]`).
// Returns a transaction spec, or null when the line is not a task.
export function toggleTaskAt(state, pos) {
  const line = state.doc.lineAt(pos);
  const b = scanBlock(line.text);
  if (b?.type !== "task") return null;
  const at = line.from + b.box + 1;
  return { changes: { from: at, to: at + 1, insert: toggledCheckChar(line.text, b.box) }, userEvent: "input.toggle" };
}

function defaultOpen(info) {
  if (info.href && /^https?:\/\//i.test(info.href)) window.open(info.href, "_blank", "noopener,noreferrer");
}

// Checkbox: a click flips one character (undoable) and does not move the caret.
// Links: Ctrl/⌘-click opens; a plain click places the caret so the text can be edited right away.
export const clickHandlers = EditorView.domEventHandlers({
  mousedown(e) {
    if (e.target.closest?.(".ef-box")) { e.preventDefault(); return true; }
    return false;
  },
  click(e, view) {
    const box = e.target.closest?.(".ef-box");
    if (box) {
      e.preventDefault();
      if (view.state.readOnly) return true;
      const spec = toggleTaskAt(view.state, view.posAtDOM(box));
      if (spec) view.dispatch(spec);
      return true;
    }
    const a = e.target.closest?.("[data-ef-type]");
    if (a && (e.ctrlKey || e.metaKey || view.state.readOnly)) {
      const info = { type: a.getAttribute("data-ef-type"), href: a.getAttribute("data-ef-href") || null, id: a.getAttribute("data-ef-id") || null, event: e };
      const handled = view.state.facet(efConfig).linkHandlers.some((h) => h(info) !== false);
      if (!handled) defaultOpen(info);
      e.preventDefault();
      return true;
    }
    return false;
  },
});
