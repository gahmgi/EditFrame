import { Facet } from "@codemirror/state";
import { createScanner } from "./marks.js";

// Per-editor configuration gathered from presets and createEditor options.
//   { rules, alwaysHide, onLinkClick }  →  combined: { scan, linkHandlers }
// Several values may be provided (one per preset); rules, hide patterns and link handlers are
// concatenated in order. Link handlers run in order until one returns something other than `false`.
export const efConfig = Facet.define({
  combine(values) {
    const rules = [], alwaysHide = [];
    const linkHandlers = [];
    for (const v of values) {
      if (v.rules) rules.push(...v.rules);
      if (v.alwaysHide) alwaysHide.push(...v.alwaysHide);
      if (v.onLinkClick) linkHandlers.push(v.onLinkClick);
    }
    return { scan: createScanner({ rules, alwaysHide }), linkHandlers };
  },
});
