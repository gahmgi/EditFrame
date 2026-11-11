// Bold / strikethrough / underline toggles on a selection — pure string transforms.
// Ported from WorkNote editing.js (toggleBoldSelection / toggleUnderlineSelection, same author).
//
// Returns { text, caretStart, caretEnd, dropBefore?, dropAfter?, noop? }:
//   caretStart/caretEnd — caret offsets inside the returned text
//   dropBefore/dropAfter — characters **outside** the selection to remove as well (unwrapping the outer marker)
//   noop — markers are mixed in the selection; the caller must leave the text alone (no change beats damage)
// Looking outside the selection matters: selecting a word inside `**bold**` and pressing B must unwrap,
// not stack markers into `****bold****` (which looks the same on screen and is hard to notice).

const asText = (v) => String(v == null ? "" : v);
const noopResult = (s) => ({ text: s, caretStart: 0, caretEnd: s.length, noop: true });

// `**` and `~~` are symmetric markers (no open/close form): same rules for both.
function toggleSymmetric(marker, sel, ctx) {
  const s = asText(sel);
  const before = asText(ctx && ctx.before), after = asText(ctx && ctx.after);
  const n = marker.length;
  // ① The whole selection is `**…**` — unwrap only if no marker remains inside
  //   (`**a** and **b**` unwrapped at the ends would become `a** and **b`).
  if (s.length >= 2 * n && s.startsWith(marker) && s.endsWith(marker)) {
    const inner = s.slice(n, -n);
    if (inner.includes(marker)) return noopResult(s);
    return { text: inner, caretStart: 0, caretEnd: inner.length };
  }
  // ② The selection sits inside `**…**`. An odd count of markers before the selection means we are inside one.
  const inside = (before.split(marker).length - 1) % 2 === 1;
  if (inside && before.endsWith(marker) && after.startsWith(marker) && !s.includes(marker)) {
    return { text: s, caretStart: 0, caretEnd: s.length, dropBefore: n, dropAfter: n };
  }
  // ③ Wrapping a selection that already has markers would stack them (`***…***`) — stop.
  if (s.includes(marker)) return noopResult(s);
  if (s === "") return { text: marker + marker, caretStart: n, caretEnd: n };
  return { text: marker + s + marker, caretStart: n, caretEnd: n + s.length };
}

export const toggleBoldSelection = (sel, ctx) => toggleSymmetric("**", sel, ctx);
// GFM strikethrough `~~…~~` (Alt+Shift+5).
export const toggleStrikeSelection = (sel, ctx) => toggleSymmetric("~~", sel, ctx);

// Underline is stored as <u>…</u> (markdown has no underline).
export function toggleUnderlineSelection(sel, ctx) {
  const s = asText(sel);
  const before = asText(ctx && ctx.before), after = asText(ctx && ctx.after);
  const mixed = s.includes("<u>") || s.includes("</u>");
  if (s.length >= 7 && s.startsWith("<u>") && s.endsWith("</u>")) {
    const inner = s.slice(3, -4);
    if (inner.includes("<u>") || inner.includes("</u>")) return noopResult(s);
    return { text: inner, caretStart: 0, caretEnd: inner.length };
  }
  if (before.endsWith("<u>") && after.startsWith("</u>") && !mixed) {
    return { text: s, caretStart: 0, caretEnd: s.length, dropBefore: 3, dropAfter: 4 };
  }
  if (mixed) return noopResult(s);
  if (s === "") return { text: "<u></u>", caretStart: 3, caretEnd: 3 };
  return { text: `<u>${s}</u>`, caretStart: 3, caretEnd: 3 + s.length };
}
