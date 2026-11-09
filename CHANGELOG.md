# Changelog

## 0.1.0 — 2026-11-09

First version, extracted from the WorkNote editor lab (same author) and generalised.

- Live preview core: headings, bold/italic/underline/strike, inline code, tasks (one-character toggle),
  bullets (`-` `*` `+`), ordered lists, quotes, rules, markdown links, bare URLs (long ones shortened),
  fenced code blocks left as text.
- GFM tables as a widget; cells edited in native `<input>`s with cell-precise byte edits
  (alignment row and padding preserved; Atomic Editor issue #18 avoided).
- Keys: list continuation on Enter, Backspace removes a hidden marker whole, Tab/Shift+Tab indent,
  Ctrl/⌘+B · U, Backspace after a table selects it.
- IME guard: decorations frozen (mapped only) while composing **and** for 400 ms after typing changes
  (WebKit Korean input without composition events), with a lost-`compositionend` fallback.
- Presets: `worknotePreset()` (`[[Title|uuid]]` chips, always-hidden `<!-- wn-op:… -->`).
- `dist/editframe.mjs` single-file ESM bundle (290.3 KB raw / 95.1 KB gzip).
- Lab with checklist, raw toggle, round-trip indicator and an input-trace recorder;
  `scripts/replay-traces.mjs` replays traces in headless Chrome via CDP.
