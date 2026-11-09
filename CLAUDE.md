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

## Structure

- `src/core/` — generic live preview. Pure judgement in `marks.js` / `table-model.js` / `format.js`
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
   composing and once at `compositionend`.
4. **Widgets next to the caret.** Checkbox/bullet widgets sit right before the first content letter. They
   are not replaced while frozen; a caret right after a line marker does not reveal it (no flip-flop).
   Remaining risk: a `contenteditable=false` widget directly before the first composed syllable — keep it
   on the device checklist.
5. **Keys during composition.** Keydown handlers ignore events with `isComposing` or `keyCode 229`
   (Enter that commits a syllable must not also split the line).
6. Any change to the guard needs: `node --test`, `node scripts/replay-traces.mjs`, and the lab checklist
   on a real iPhone. A trace from the lab's 「입력 기록」 that shows a bug becomes a file in `traces/`.

## Verifying

- `npm test` — unit + round-trip + IME guard (state level) + dist import.
- `npm run build` — prints raw/gzip size.
- `node scripts/replay-traces.mjs` — headless Chrome via CDP: lab loads without errors, then replays
  `traces/*.json` (insertText, replacement, `Input.imeSetComposition`, keys, table cells).
- `npm run serve` (`-- --host` for the LAN) → `/lab/` on PC and iPhone. CDP cannot reproduce the iOS
  keyboard (predictive bar, 3-finger undo, selection handles); those need the device.
- Kill servers by port/handle only — never `taskkill /IM node.exe` (it also kills MCP servers).

## How WorkNote consumes EditFrame

WorkNote is a no-build static PWA. It vendors **one file**: copy `dist/editframe.mjs` into WorkNote's
`vendor/` (pin by EditFrame version/commit in its changelog), then
`import { createEditor, worknotePreset } from "./vendor/editframe.mjs"`. CodeMirror is inside the bundle;
WorkNote must not load another CodeMirror copy (use the re-exported `EditorView`/`EditorState` for extra
extensions). WorkNote is never modified from this repo.
