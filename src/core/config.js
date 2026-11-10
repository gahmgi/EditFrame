import { Facet } from "@codemirror/state";
import { createScanner } from "./marks.js";

// Per-editor configuration gathered from presets and createEditor options.
//   { rules, alwaysHide, onLinkClick, openButton }  →  combined: { scan, linkHandlers, openButton }
// Several values may be provided (one per preset); rules, hide patterns and link handlers are
// concatenated in order. Link handlers run in order until one returns something other than `false`.
// `openButton` (show 「열기 ↗」 next to the link the caret is in): the last boolean given wins.
export const efConfig = Facet.define({
  combine(values) {
    const rules = [], alwaysHide = [];
    const linkHandlers = [];
    let openButton = false;
    for (const v of values) {
      if (v.rules) rules.push(...v.rules);
      if (v.alwaysHide) alwaysHide.push(...v.alwaysHide);
      if (v.onLinkClick) linkHandlers.push(v.onLinkClick);
      if (typeof v.openButton === "boolean") openButton = v.openButton;
    }
    return { scan: createScanner({ rules, alwaysHide }), linkHandlers, openButton };
  },
});

// Touch devices get the open button by default: there is no Ctrl/⌘-click on a phone.
export function coarsePointer() {
  try { return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches; } catch { return false; }
}

// Mouse / trackpad (Windows, Mac). False when unknown, so touch behaviour is the default.
export function finePointer() {
  try { return typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches; } catch { return false; }
}
