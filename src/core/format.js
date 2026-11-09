// Bold / underline toggles on a selection — pure string transforms.
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

export function toggleBoldSelection(sel, ctx) {
  const s = asText(sel);
  const before = asText(ctx && ctx.before), after = asText(ctx && ctx.after);
  // ① The whole selection is `**…**` — unwrap only if no marker remains inside
  //   (`**a** and **b**` unwrapped at the ends would become `a** and **b`).
  if (s.length >= 4 && s.startsWith("**") && s.endsWith("**")) {
    const inner = s.slice(2, -2);
    if (inner.includes("**")) return noopResult(s);
    return { text: inner, caretStart: 0, caretEnd: inner.length };
  }
  // ② The selection sits inside `**…**`. `**` has no open/close form, so "inside a span" and "between two
  //   spans" look the same locally; an odd count of `**` before the selection means we are inside one.
  const insideBold = ((before.match(/\*\*/g) || []).length % 2) === 1;
  if (insideBold && before.endsWith("**") && after.startsWith("**") && !s.includes("**")) {
    return { text: s, caretStart: 0, caretEnd: s.length, dropBefore: 2, dropAfter: 2 };
  }
  // ③ Wrapping a selection that already has markers would produce `***…***` — stop.
  if (s.includes("**")) return noopResult(s);
  if (s === "") return { text: "****", caretStart: 2, caretEnd: 2 };
  return { text: `**${s}**`, caretStart: 2, caretEnd: 2 + s.length };
}

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
