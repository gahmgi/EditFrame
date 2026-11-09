// WorkNote preset — syntax that only WorkNote uses. Kept out of the core on purpose.
//
//   [[Title|uuid]]          internal note link → shown as a chip with the title only
//                           (same token as WorkNote connections.js TOKEN_RE — keep them identical)
//   <!-- wn-op:… -->        sync idempotency marker → always hidden, even on the caret's line;
//                           a line holding only markers is hidden entirely
//                           (same pattern as WorkNote connections.js OP_MARKER_RE, minus the leading newline)
//
// A preset is a plain object:
//   { name, rules?: InlineRule[], alwaysHide?: RegExp[], extensions?: Extension[], onLinkClick?(info) }
// InlineRule: { type, re (global RegExp), parts(match) → { hide: [[a,b],…], ...extra }, className?, exclusive? }
//   offsets in `hide` are relative to the match start; extra fields (e.g. `id`, `href`) are passed to
//   onLinkClick as { type, id, href }.

export const WN_LINK_RE = /\[\[([^\]|\n]+?)\|([0-9a-f]{8}-[0-9a-f-]{27,})\]\]/gi;
export const WN_OP_RE = /[ \t]*<!--\s*wn-op:.*?-->/gi;

// options.onOpenNote(id, info) — called on Ctrl/⌘-click (or any click in read-only mode) on a note chip.
export function worknotePreset(options = {}) {
  return {
    name: "worknote",
    alwaysHide: [WN_OP_RE],
    rules: [
      {
        type: "wnlink",
        className: "ef-wnlink",
        re: WN_LINK_RE,
        parts: (m) => ({ hide: [[0, 2], [2 + m[1].length, m[0].length]], id: m[2].toLowerCase() }),
      },
    ],
    onLinkClick: options.onOpenNote
      ? (info) => {
          if (info.type !== "wnlink") return false; // let other links use the default behaviour
          options.onOpenNote(info.id, info);
          return true;
        }
      : undefined,
  };
}
