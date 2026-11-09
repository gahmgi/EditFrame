import { EditorView } from "@codemirror/view";

// Base styles. Colors come from CSS custom properties so a host app can restyle without overriding rules:
//   --ef-muted   revealed markers, bullets, done tasks      --ef-accent  links, checkbox
//   --ef-line    table borders, rules, quote bar             --ef-code-bg inline code / code block background
//   --ef-chip-bg preset chips (e.g. WorkNote note links)
// Marker reveal keeps the same font size as the text (a size change would make the line jump).
const v = (name, light, dark) => ({ light: `var(${name}, ${light})`, dark: `var(${name}, ${dark})` });
const C = {
  muted: v("--ef-muted", "#6b7280", "#9aa3ad"),
  accent: v("--ef-accent", "#2f5f8a", "#8fb9df"),
  line: v("--ef-line", "#d9dbd6", "#3c454f"),
  codeBg: v("--ef-code-bg", "rgba(127,127,127,.12)", "rgba(160,160,160,.16)"),
  chipBg: v("--ef-chip-bg", "rgba(47,95,138,.10)", "rgba(143,185,223,.16)"),
};
const both = (mode) => ({
  [`&${mode} .ef-mark, &${mode} .ef-bullet, &${mode} .ef-done, &${mode} .ef-ol .ef-mark`]: { color: C.muted[mode] },
  [`&${mode} .ef-link`]: { color: C.accent[mode], textDecorationColor: C.accent[mode] },
  [`&${mode} .ef-box input`]: { accentColor: C.accent[mode] },
  [`&${mode} .ef-table th, &${mode} .ef-table td`]: { borderColor: C.line[mode] },
  [`&${mode} .ef-hr`]: { borderTopColor: C.line[mode] },
  [`&${mode} .ef-quote`]: { borderLeftColor: C.line[mode], color: C.muted[mode] },
  [`&${mode} .ef-code-inline, &${mode} .ef-codeblock`]: { backgroundColor: C.codeBg[mode] },
  [`&${mode} .ef-wnlink`]: { backgroundColor: C.chipBg[mode], color: C.accent[mode] },
});

export const editFrameTheme = EditorView.baseTheme({
  ".ef-h": { fontWeight: "600", letterSpacing: "-.02em" },
  ".ef-h1": { fontSize: "1.45em", paddingTop: ".5em" },
  ".ef-h2": { fontSize: "1.25em", paddingTop: ".5em" },
  ".ef-h3": { fontSize: "1.1em", paddingTop: ".3em" },
  ".ef-bold": { fontWeight: "700" },
  ".ef-italic": { fontStyle: "italic" },
  ".ef-u": { textDecoration: "underline", textUnderlineOffset: ".15em" },
  ".ef-strike": { textDecoration: "line-through" },
  ".ef-link": { textDecoration: "underline", textUnderlineOffset: ".15em", cursor: "text" },
  ".ef-code-inline": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: ".92em", borderRadius: "4px", padding: "0 .2em" },
  ".ef-codeblock": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: ".92em" },
  ".ef-quote": { borderLeft: "3px solid", paddingLeft: ".8em !important" },
  ".ef-hr-line": { display: "flex", alignItems: "center" },
  ".ef-hr": { display: "inline-block", width: "100%", borderTop: "1px solid", verticalAlign: "middle" },
  // Width must match LEAD (1.6em) in preview.js so hanging indents line up.
  ".ef-lead": { display: "inline-block", width: "1.6em", textIndent: "0", textAlign: "left", verticalAlign: "baseline" },
  ".ef-box input": { margin: "0", width: "1.15em", height: "1.15em", verticalAlign: "-.18em", cursor: "pointer" },
  ".ef-wnlink": { borderRadius: "6px", padding: "0 .3em", textDecoration: "none" },
  ".ef-table": { overflowX: "auto", padding: ".3em 0" },
  ".ef-table table": { borderCollapse: "collapse", minWidth: "50%" },
  ".ef-table th": { fontWeight: "600" },
  ".ef-table th, .ef-table td": { border: "1px solid", padding: ".25em .6em", minWidth: "3em", verticalAlign: "top", textAlign: "left", cursor: "text" },
  ".ef-cell-view": { whiteSpace: "pre-wrap", display: "inline-block", minHeight: "1.5em", minWidth: "1em" },
  // Native input for editing. 16px minimum: iOS zooms the page when focusing a smaller input.
  ".ef-cell-input": { display: "none", width: "100%", boxSizing: "border-box", border: "0", padding: "0", margin: "0", font: "inherit", fontSize: "max(16px, 1em)", color: "inherit", background: "transparent", outline: "none" },
  ".ef-editing .ef-cell-view": { display: "none" },
  ".ef-editing .ef-cell-input": { display: "block" },
  ".ef-editing": { boxShadow: "inset 0 0 0 2px var(--ef-accent, #2f5f8a)" },
  ...both("light"),
  ...both("dark"),
});
