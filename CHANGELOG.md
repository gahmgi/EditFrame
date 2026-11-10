# Changelog

## Unreleased — 2026-11-10

- Completion criteria and non-goals documented (README 「완성 기준」, CLAUDE.md), each tied to a test.
- Tables: one «⋯» handle on the focused cell opens 위/아래에 줄 넣기 · 왼쪽/오른쪽에 열 넣기 · 이 줄/이 열 지우기
  (header protected, only column protected). Row edits touch one line; column edits one cell segment per
  row. One undo step per action. Ctrl/⌘+Enter in a cell adds a row below.
- Paste: HTML tables (rowspan repeated, colspan into the first cell) and spreadsheet TSV become GFM tables;
  pasting inside a cell becomes one line.
- Touch: 「열기 ↗」 next to the link / note chip holding the caret (`openButton` option, default on coarse
  pointers; never while typing or composing). 3+-finger `touchmove` no longer scrolls (iOS undo gesture).
- `scripts/bench.mjs` long-note benchmark; lab samples 「표 편집해 보기」 and 「긴 글 불러오기」;
  `scripts/cdp.mjs` shared by the replay and bench scripts.
- Review fixes: inserted line breaks follow the document's separator (CRLF documents no longer get a bare
  `\n` inside a line — table rows, appended rows, pasted tables, list continuation, leaving a table); HTML
  paste converts only a clipboard that is exactly one data table; no conversion inside fenced code or on
  Ctrl/⌘+Shift+V; table widgets release their document/viewport listeners on destroy; inserted rows keep the
  table's indentation; pasted `\` before `|` is escaped; on fine pointers the table menu blurs the cell
  (OS IME commit) before the edit; the 3-finger guard adds its non-passive touchmove only during 3+-finger
  touches.
- `dist/editframe.mjs` 303.9 KB raw / 99.7 KB gzip.

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
