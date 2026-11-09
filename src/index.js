// EditFrame — a framework-free CodeMirror 6 live-preview markdown editor.
//
// Public API (keep it small):
//   createEditor(parent, options) → handle         the usual entry point
//   createState(doc, options)     → EditorState    same document + extensions, without a view
//                                                   (tests, or hosts that build their own EditorView)
//   worknotePreset(options)       → preset object  WorkNote-only syntax
//   toggleTaskAt(state, pos)      → transaction spec flipping one checkbox character, or null
//   VERSION
//   EditorView, EditorState       re-exported so hosts that pass `extensions` use the CodeMirror copy
//                                 bundled here (two copies of @codemirror/state break instanceof checks)
//
// The markdown text is the source of truth. Nothing in EditFrame rewrites text the user did not edit:
// opening and closing a document without edits returns it byte for byte (read it back with getDoc() /
// state.sliceDoc(), which keep the document's own line separator).

import { EditorState, EditorSelection, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { efConfig } from "./core/config.js";
import { preview, compositionWatch, clickHandlers, toggleTaskAt } from "./core/preview.js";
import { editKeys } from "./core/keys.js";
import { editFrameTheme } from "./core/theme.js";

export { worknotePreset } from "./presets/worknote.js";
export { toggleTaskAt, EditorView, EditorState };
export const VERSION = "0.1.0";

// Live preview pieces: decorations + IME guard + checkbox/link clicks + base theme.
const LIVE = [preview, compositionWatch, clickHandlers, editFrameTheme];
const readOnlyExt = (on) => (on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []);

// CodeMirror splits lines on \r\n, \r and \n and joins with \n unless told otherwise. A document that
// uses \r\n throughout keeps it; a document mixing separators is normalised to \n (documented limitation).
function lineSeparatorFor(doc) {
  return /\r\n/.test(doc) && !/(^|[^\r])\n/.test(doc) && !/\r(?!\n)/.test(doc) ? "\r\n" : null;
}

/**
 * Build an EditorState with every EditFrame extension.
 * @param {string} doc
 * @param {object} [options] same as createEditor (presets, onLinkClick, readOnly, raw, ariaLabel, extensions, onChange)
 */
export function createState(doc, options = {}, slots = { preview: new Compartment(), readOnly: new Compartment() }) {
  const text = String(doc ?? "");
  const sep = lineSeparatorFor(text);
  const presets = options.presets || [];
  const state = EditorState.create({
    doc: text,
    extensions: [
      ...(sep ? [EditorState.lineSeparator.of(sep)] : []),
      history(),
      editKeys,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", "aria-label": options.ariaLabel || "본문" }),
      // The host's own link handler runs before preset handlers.
      efConfig.of({ onLinkClick: options.onLinkClick }),
      ...presets.map((p) => efConfig.of(p)),
      slots.preview.of(options.raw ? [] : LIVE),
      slots.readOnly.of(readOnlyExt(!!options.readOnly)),
      ...presets.flatMap((p) => p.extensions || []),
      ...(options.extensions || []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && options.onChange) options.onChange(u.state.sliceDoc(), { composing: u.view.composing });
      }),
    ],
  });
  // Start with the caret at the end: at 0 the first heading's `## ` would be revealed on open.
  return state.update({ selection: EditorSelection.cursor(state.doc.length) }).state;
}

/**
 * Create an editor inside `parent`.
 *
 * @param {HTMLElement} parent
 * @param {object} [options]
 * @param {string}   [options.doc=""]        initial markdown
 * @param {object[]} [options.presets=[]]    e.g. [worknotePreset()]
 * @param {(doc: string, info: { composing: boolean }) => void} [options.onChange]
 *        called after every document change. `composing` is true while an IME composition is active —
 *        hosts that save should debounce and may skip saves while composing.
 * @param {boolean}  [options.readOnly=false]
 * @param {boolean}  [options.raw=false]     start in raw-markdown mode (no live preview)
 * @param {(info: { type: string, href: string|null, id: string|null, event: MouseEvent }) => boolean|void} [options.onLinkClick]
 *        Ctrl/⌘-click on a link (any click when read-only). Return false to fall back to the default
 *        (http/https opens in a new tab).
 * @param {string}   [options.ariaLabel="본문"]
 * @param {object[]} [options.extensions=[]] extra CodeMirror extensions (build them with the re-exported
 *        EditorView / EditorState)
 * @returns {{ view: EditorView, getDoc(): string, setDoc(text: string): void, setRaw(on: boolean): void,
 *             isRaw(): boolean, setReadOnly(on: boolean): void, focus(): void, destroy(): void }}
 */
export function createEditor(parent, options = {}) {
  const slots = { preview: new Compartment(), readOnly: new Compartment() };
  let raw = !!options.raw;
  let readOnly = !!options.readOnly;
  const makeState = (doc) => createState(doc, { ...options, raw, readOnly }, slots);
  const view = new EditorView({ state: makeState(options.doc), parent });

  return {
    view,
    getDoc: () => view.state.sliceDoc(),
    // Replace the document. Undo history starts fresh; onChange is not called.
    setDoc: (text) => view.setState(makeState(text)),
    // Raw mode shows the markdown as-is (editing still works).
    setRaw(on) {
      raw = !!on;
      view.dispatch({ effects: slots.preview.reconfigure(raw ? [] : LIVE) });
    },
    isRaw: () => raw,
    setReadOnly(on) {
      readOnly = !!on;
      view.dispatch({ effects: slots.readOnly.reconfigure(readOnlyExt(readOnly)) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
