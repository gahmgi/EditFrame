# Third-party notices

## Bundled in `dist/editframe.mjs`

`dist/editframe.mjs` bundles the following packages, all under the MIT License,
Copyright (C) 2016–2024 Marijn Haverbeke and others:

| Package | Version |
| --- | --- |
| @codemirror/state | 6.7.6 |
| @codemirror/view | 6.43.15 |
| @codemirror/commands | 6.11.1 |
| @codemirror/language (pulled in by commands) | 6.13.1 |
| @lezer/common, @lezer/highlight, @lezer/lr (as needed by the above) | 1.5.5, 1.2.5, 1.4.12 |
| @marijn/find-cluster-break | 1.0.4 |
| style-mod | 4.1.4 |
| w3c-keyname | 2.2.8 |
| crelt | 1.0.7 |

The full MIT license text is in each package's `LICENSE` file (installed under `node_modules/`) and
is the same as the text below, with the copyright line above.

## Atomic Editor — ideas and adapted logic

- Project: Atomic Editor, https://github.com/kenforthewin/atomic-editor (npm `@atomic-editor/editor`)
- Version examined: 0.6.2, commit `b6ed65f01bde4510031bc7a495520bc1a7688c66`
- License: MIT, Copyright (c) 2026 Kenny Bergquist

No Atomic Editor file was copied verbatim, so there is no `src/vendor/atomic-editor/` directory.
What EditFrame adapted from its table widget (`src/table-widget.ts`):

- `splitCells` in `src/core/table-model.js` follows `splitRowCells` (unescaped `|` separates cells,
  optional outer pipes), rewritten to return offsets for range-precise edits.
- Patterns in `src/core/table.js`: one block replace widget over the table range; no updates while an
  IME composition is active and one commit at `compositionend`; Tab/Enter cell navigation; a
  double-`requestAnimationFrame` before focusing a cell after a structural change; Backspace on the line
  after a table selects the table instead of merging into it.

Deliberate differences (and why Atomic's widget was not used as a dependency):

1. It re-serialises the **whole table** from its DOM model on every keystroke, which rewrites the
   alignment row (`:---:` → `---`) and every row's padding. EditFrame's rule is that only edited bytes
   change, so EditFrame edits one cell's byte range only.
2. Its cell commit trims and collapses whitespace on every keystroke (`replace(/\s+/g, ' ').trim()`),
   which causes issue #18 (spaces disappear while typing in cells; the caret jumps). EditFrame keeps the
   typed text as is and fixes the cell padding once per edit session.
3. Cells are `contenteditable` with decorated DOM rebuilt per keystroke; EditFrame uses a native
   `<input>` per cell (the most IME-stable surface on iOS).
4. Its package entry point re-exports a React component (`react` is a peer dependency) and it depends on
   the full `@codemirror/lang-markdown` parser; EditFrame stays framework-free and parser-free.

```
MIT License

Copyright (c) 2026 Kenny Bergquist

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Observations credited (no code used)

- WebKit Korean IME behaviour without composition events (`insertText` + `insertReplacementText`,
  `isComposing === false`) and the trace-capture/replay idea were observed in TerminalAssistance,
  https://github.com/zzamjak-cloud/TerminalAssistance (GPL-3.0-only). **No code from that project is
  used in EditFrame**; only the observation informed the design.
