# EditFrame — project rules

Personal project of `gahmgi`. **Public repo** (`github.com/gahmgi/EditFrame`, MIT). Anything committed is
public forever.

## Identity and commits (strict)

- Commit only as `gahmgi <gahmhg@gmail.com>` (the address is `gahmhg`, not `gahmgi`). The machine's global
  git email is a company address and must never appear in this repo. Repo-local config holds the right
  identity; check `git config user.email` before committing.
- `.git/hooks/pre-commit` rejects any other author email; `.git/hooks/commit-msg` rejects a
  `Co-Authored-By` trailer. Hooks are not versioned — recreate them on a fresh clone (copy from README).
- No `Co-Authored-By` or model-identifier trailers in commit messages.
- No company data, company names, people, HR topics or work e-mail addresses anywhere (code, samples,
  tests, traces, docs). Samples use neutral content (장보기, 독서 메모, 주간 계획 …).
- Recorded input traces contain whatever was typed — review them before committing.

## The one design rule: markdown text is the source of truth

- EditFrame only changes how text is **drawn** (CodeMirror decorations/widgets). It never rewrites text
  the user did not edit. Opening and closing a document without edits returns it byte for byte.
- Edits are minimal: a checkbox toggle changes one character; a table cell edit changes that cell's bytes
  only (no re-serialising the table, no re-padding, alignment row untouched).
- `test/roundtrip.test.js` must pass: every sample in `lab/samples.js` (add new syntax samples there) is
  loaded with every option set, the caret visits every position, and the text must not change.
- Read text back with `getDoc()` / `state.sliceDoc()` (keeps `\r\n` documents intact), not
  `state.doc.toString()`.
- Write line breaks in dispatched text through `withLineBreaks(state, s)` (table.js) / `state.lineBreak`. A
  `\r\n` document sets `EditorState.lineSeparator`, and then a bare `"\n"` in an insert stays *inside* a line.
  `test/table-edit.test.js` covers the CRLF paths.

## Completion criteria (each guarded by a test)

1. Korean input never breaks on iPhone or PC — `test/ime-guard.test.js`, `scripts/replay-traces.mjs`
   (traces). Real-device check passed 2026-11-10. Never weaken the guards (compose, `HOT_MS`, native cell inputs).
2. Open → close is byte-identical — `test/roundtrip.test.js`.
3. Results instead of symbols (tables, checkboxes, links) — `test/marks.test.js`, the lab smoke check in
   `replay-traces.mjs` (`rawSyntaxVisible=[]`).
4. Table rows/columns can be inserted and deleted — `test/table-model.test.js` (pure transforms, byte
   discipline), the table-menu check in `replay-traces.mjs`.
5. Pasting a table from Excel or the web yields a clean GFM table — `test/paste.test.js`.
6. On iPhone, undo and opening links are easy — `test/open-button.test.js` (when 「열기 ↗」 shows); the
   3-finger undo scroll guard is device-only (lab checklist).
7. Long notes do not stutter — `node scripts/bench.mjs`: decoration recompute < 8 ms per keystroke on a
   ~2,000-line note. Numbers are recorded in README 「완성 기준」.

Non-goals (decided, do not reopen): merged cells (no GFM syntax; display-only merging would make screen and
text disagree), stored column widths (columns auto-fit), colors, a free-form document model (the markdown
text stays the source of truth).

## Structure

- `src/core/` — generic live preview. Pure judgement in `marks.js` / `table-model.js` / `format.js` / `paste.js`
  (node-testable); CodeMirror glue in `preview.js` (decorations + IME guard), `table.js` (table widget),
  `keys.js`, `theme.js`, `config.js` (preset facet).
- `src/presets/` — product-specific syntax. WorkNote rules (`[[Title|uuid]]`, `<!-- wn-op:… -->`) live
  only in `presets/worknote.js`; the core must not know them.
- `src/index.js` — the small public API. Keep it small and documented.
- `dist/editframe.mjs` — committed build output. Rebuild (`npm run build`) and commit it with any `src/`
  change, and update the size in README.

## iOS IME (Korean) — rules

The chronic failure mode: the DOM around text that is still being entered changes (a widget is replaced,
a hidden range moves, a decoration is added), and iOS Safari / Windows Chrome then duplicate or drop
jamo. Rules:

1. **Freeze while entering text.** `preview.js` never recomputes decorations while "frozen"; it only maps
   the existing set through each change. Frozen means either
   - `compose`: an `input.type.compose` transaction or a seen `compositionstart`, until `compositionend`
     (with a 300 ms fallback if `compositionend` is lost — seen after predictive-text taps / blur), or
   - `hot`: any typing change (`input.type…`, `delete…`), until `HOT_MS` (400 ms) after the last one, or
     until the caret leaves that line.
2. **Do not rely on composition events.** WebKit's Korean IME often sends none: a syllable arrives as
   `insertText`, its growth as `insertReplacementText` replacing the previous character, with
   `isComposing === false` (observed in TerminalAssistance,
   https://github.com/zzamjak-cloud/TerminalAssistance — GPL-3.0, ideas only, no code copied). The `hot`
   window exists for exactly this path. Treat it as the expected iOS path until a real iPhone trace says
   otherwise.
3. **Native inputs for embedded editing.** Table cells are edited in a native `<input>` inside the widget
   (no CodeMirror decorations or DOM rewrites inside the cell; the OS owns the composition). The
   `updateDOM` of the table widget never touches the input being edited. Cells commit nothing while
   composing and once at `compositionend`. The «⋯» handle and menu live outside the cell; taps on them
   cancel `mousedown`/`touchend` so the cell input keeps focus (no keyboard bounce).
4. **Widgets next to the caret.** Checkbox/bullet widgets sit right before the first content letter. They
   are not replaced while frozen; a caret right after a line marker does not reveal it (no flip-flop).
   「열기 ↗」 (touch) is built only by a full recompute, so never while frozen, and only for a caret strictly
   inside a link (never at its end, where typing continues).
   Remaining risk: a `contenteditable=false` widget directly before the first composed syllable — keep it
   on the device checklist.
5. **Keys during composition.** Keydown handlers ignore events with `isComposing` or `keyCode 229`
   (Enter that commits a syllable must not also split the line).
6. Any change to the guard needs: `node --test`, `node scripts/replay-traces.mjs`, and the lab checklist
   on a real iPhone. A trace from the lab's 「입력 기록」 that shows a bug becomes a file in `traces/`.

## Verifying

- `npm test` — unit + round-trip + IME guard (state level) + dist import.
- `npm run build` — prints raw/gzip size.
- `node scripts/replay-traces.mjs` — headless Chrome via CDP (`scripts/cdp.mjs`): lab loads without errors,
  the table «⋯» menu (every item, mouse + raw touch), 「열기 ↗」 (touch emulation) and paste (real DOMParser)
  are checked, then `traces/*.json` are replayed (insertText, replacement, `Input.imeSetComposition`, keys,
  table cells). Headless Chrome does not turn touches into clicks, so iOS tap behaviour still needs the device.
- `node scripts/bench.mjs` — long-note timing (criterion 7); exits 1 when over budget. Record new numbers in
  README 「완성 기준」 when the decoration code changes.
- `npm run serve` (`-- --host` for the LAN) → `/lab/` on PC and iPhone. CDP cannot reproduce the iOS
  keyboard (predictive bar, 3-finger undo, selection handles); those need the device.
- Kill servers by port/handle only — never `taskkill /IM node.exe` (it also kills MCP servers).

## How WorkNote consumes EditFrame

WorkNote is a no-build static PWA. It vendors **one file**: copy `dist/editframe.mjs` into WorkNote's
`vendor/` (pin by EditFrame version/commit in its changelog), then
`import { createEditor, worknotePreset } from "./vendor/editframe.mjs"`. CodeMirror is inside the bundle;
WorkNote must not load another CodeMirror copy (use the re-exported `EditorView`/`EditorState` for extra
extensions). WorkNote is never modified from this repo.
