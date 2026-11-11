// Replay input traces against the built editor in headless Chrome (CDP), and smoke-test the lab.
//
//   node scripts/replay-traces.mjs                 all traces in traces/
//   node scripts/replay-traces.mjs traces/x.json   one trace
//   CHROME_PATH=... node scripts/replay-traces.mjs
//
// 1. Starts scripts/serve.mjs on a free port, launches headless Chrome with a throwaway profile (cdp.mjs).
// 2. Opens /lab/ (which imports dist/editframe.mjs) and fails on any console error or uncaught exception.
// 3. Lab checks: the table «⋯» menu (every item, mouse + touch), 「열기 ↗」 (touch emulation), paste.
// 4. For each trace: loads setup.doc, places the caret, runs the steps through real input paths, waits for
//    the IME guard's idle window, and compares the document with `expect` (byte for byte).
//
// Step ops (trace format "editframe-trace/1", see README):
//   insertText {text}        Input.insertText — a plain insertion (iOS/WebKit: inputType insertText)
//   replacePrev {len, text}  select the previous `len` characters, then Input.insertText — the closest
//                            Chrome equivalent of WebKit's insertReplacementText (Chrome reports it as
//                            insertText, but the DOM/selection path is the same: replace the last letter)
//   ime {text}               Input.imeSetComposition — composition update (compositionstart/update)
//   commit {text}            Input.insertText while composing — commits the composition (compositionend)
//   key {key}                Input.dispatchKeyEvent (Enter, Backspace, Tab, Escape, arrows)
//   cell {row, col}          click a table cell (row 0 = header) to edit it
//   wait {ms}
// Processes are stopped through their own handles (never by image name).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openLab, root, sleep } from "./cdp.mjs";

const HOT_IDLE_MS = 700; // > HOT_MS (400) in src/core/preview.js, so the deferred recompute has run

const KEYS = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

async function runStep(cdp, s) {
  switch (s.op) {
    case "insertText": return cdp.send("Input.insertText", { text: s.text });
    case "commit": return cdp.send("Input.insertText", { text: s.text });
    case "ime": return cdp.send("Input.imeSetComposition", { text: s.text, selectionStart: s.text.length, selectionEnd: s.text.length });
    case "replacePrev":
      await cdp.eval(`(() => {
        const a = document.activeElement;
        if (a && a.tagName === "INPUT") { const p = a.selectionStart; a.setSelectionRange(Math.max(0, p - ${s.len}), p); return; }
        const v = __ef.editor.view, h = v.state.selection.main.head;
        v.dispatch({ selection: { anchor: Math.max(0, h - ${s.len}), head: h } });
      })()`);
      return cdp.send("Input.insertText", { text: s.text });
    case "key": {
      const code = KEYS[s.key];
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: s.key, code: s.key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      if (s.key === "Enter") await cdp.send("Input.dispatchKeyEvent", { type: "char", key: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
      return cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: s.key, code: s.key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    }
    case "cell":
      return cdp.eval(`(() => {
        const td = __ef.editor.view.dom.querySelector('.ef-table [data-row="${s.row}"][data-col="${s.col}"]');
        if (!td) throw new Error("cell not found");
        td.querySelector(".ef-cell-view").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        if (document.activeElement?.tagName !== "INPUT") throw new Error("cell input not focused");
      })()`);
    case "wait": return sleep(s.ms);
    default: throw new Error("unknown op " + s.op);
  }
}

// Real input on an element: a mouse click, or a raw touch (touchstart + touchend). Headless Chrome does not
// turn a touch into compatibility mouse events or a click, so the touch path checks the touchend handling only.
async function tapElement(cdp, selector, how) {
  const r = await cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r) throw new Error("not found: " + selector);
  if (how === "touch") {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
    return cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  return cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
}

// Table «⋯» menu: every item through real mouse and touch taps. The cell input must keep focus while the
// handle and menu are used, the document must match the pure transform, focus must land on a sensible cell,
// and one undo must restore the text.
async function tableMenuCheck(cdp, problems) {
  const { insertRow, deleteRow, insertColumn, deleteColumn } = await import("../src/core/table-model.js");
  const DOC = "앞 문단\n\n| 품목 |  수량 | 메모 |\n| :--- | ---: | :-: |\n| 사과 | 3 | x \\| y |\n| 우유 | 1 |\n\n끝";
  const tableStart = DOC.indexOf("| 품목");
  const tableLines = DOC.slice(tableStart).split("\n").slice(0, 4);
  const expectFor = (res) => {
    let out = DOC;
    for (const c of [...res.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, tableStart + c.from) + c.insert + out.slice(tableStart + c.to);
    return out;
  };
  const cases = [
    ["rowAbove", 1, 1, () => insertRow(tableLines, 1, false), [1, 1]],
    ["rowBelow", 0, 2, () => insertRow(tableLines, 0, true), [1, 2]],
    ["colLeft", 2, 0, () => insertColumn(tableLines, 0, false), [2, 0]],
    ["colRight", 1, 2, () => insertColumn(tableLines, 2, true), [1, 3]],
    ["rowDelete", 1, 1, () => deleteRow(tableLines, 1), [1, 1]],
    ["rowDelete", 2, 0, () => deleteRow(tableLines, 2), [1, 0]],
    ["colDelete", 1, 2, () => deleteColumn(tableLines, 2), [1, 1]],
  ];
  let bad = 0;
  const before = problems.length;
  for (const [i, [action, row, col, fn, [fr, fc]]] of cases.entries()) {
    const how = i % 2 ? "touch" : "mouse";
    const fail = (msg) => { bad++; console.log(`FAIL table menu ${action} (${how}): ${msg}`); };
    await cdp.eval(`(() => { __ef.load("basic"); __ef.editor.setDoc(${JSON.stringify(DOC)}); })()`);
    await sleep(50);
    try {
      await tapElement(cdp, `.ef-table [data-row="${row}"][data-col="${col}"] .ef-cell-view`, "mouse");
      await sleep(60);
      const hidden = await cdp.eval(`document.querySelector(".ef-table-handle").hidden`);
      if (hidden) { fail("handle not shown for a focused cell"); continue; }
      await tapElement(cdp, ".ef-table-handle", how);
      await sleep(60);
      const st = await cdp.eval(`(() => { const a = document.activeElement; const td = a?.closest?.("th, td");
        return { menu: !document.querySelector(".ef-table-menu").hidden, cell: td ? [Number(td.dataset.row), Number(td.dataset.col)] : null,
          disabled: [...document.querySelectorAll(".ef-table-menu button:disabled")].map((b) => b.dataset.action) }; })()`);
      if (!st.menu) { fail("menu did not open"); continue; }
      if (JSON.stringify(st.cell) !== JSON.stringify([row, col])) { fail("cell input lost focus when the handle was tapped: " + JSON.stringify(st.cell)); continue; }
      const wantOff = row === 0 ? ["rowAbove", "rowDelete"] : [];
      if (JSON.stringify(st.disabled) !== JSON.stringify(wantOff)) { fail("disabled items " + JSON.stringify(st.disabled)); continue; }
      await tapElement(cdp, `.ef-table-menu [data-action="${action}"]`, how);
      await sleep(120);
      const after = await cdp.eval(`(() => { const a = document.activeElement; const td = a?.closest?.("th, td");
        return { doc: __ef.editor.getDoc(), cell: td ? [Number(td.dataset.row), Number(td.dataset.col)] : null }; })()`);
      if (after.doc !== expectFor(fn())) { fail(`document\n  expected ${JSON.stringify(expectFor(fn()))}\n  got      ${JSON.stringify(after.doc)}`); continue; }
      if (JSON.stringify(after.cell) !== JSON.stringify([fr, fc])) { fail("focus after the action " + JSON.stringify(after.cell)); continue; }
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
      await sleep(60);
      if (await cdp.eval("__ef.editor.getDoc()") !== DOC) fail("one undo did not restore the text");
    } catch (e) { fail(e.message); }
  }
  // Ctrl+Enter in a cell adds a row below and moves into it.
  await cdp.eval(`(() => { __ef.load("basic"); __ef.editor.setDoc(${JSON.stringify(DOC)}); })()`);
  await sleep(50);
  await tapElement(cdp, `.ef-table [data-row="1"][data-col="0"] .ef-cell-view`, "mouse");
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 2 });
  await sleep(120);
  const ce = await cdp.eval(`(() => { const td = document.activeElement?.closest?.("th, td"); return { doc: __ef.editor.getDoc(), cell: td ? [Number(td.dataset.row), Number(td.dataset.col)] : null }; })()`);
  if (ce.doc !== expectFor(insertRow(tableLines, 1, true)) || JSON.stringify(ce.cell) !== "[2,0]") { bad++; console.log("FAIL table Ctrl+Enter: " + JSON.stringify(ce)); }
  // The handle and menu disappear when no cell is focused.
  await cdp.eval(`(() => { const a = document.activeElement; if (a?.blur) a.blur(); })()`);
  const gone = await cdp.eval(`[...document.querySelectorAll(".ef-table-handle, .ef-table-menu")].every((e) => e.hidden)`);
  if (!gone) { bad++; console.log("FAIL table menu: handle/menu visible without a focused cell"); }
  // An open menu registers document scroll / visualViewport resize listeners. Replacing the widget (new
  // document) or destroying the editor must remove them. Count them through wrapped add/removeEventListener.
  await cdp.eval(`(() => {
    // Live listeners as [target, type, fn] — the same function is added to both targets.
    const live = window.__liveList = [];
    Object.defineProperty(window, "__live", { configurable: true, get: () => ({ size: live.length }) });
    for (const [target, name] of [[document, "doc"], [window.visualViewport, "vv"]]) {
      if (!target || target.__efWrapped) continue;
      const add = target.addEventListener.bind(target), rem = target.removeEventListener.bind(target);
      target.addEventListener = (t, fn, o) => { if (t === "scroll" || t === "resize") live.push([name, t, fn]); add(t, fn, o); };
      target.removeEventListener = (t, fn, o) => { const i = live.findIndex((e) => e[0] === name && e[1] === t && e[2] === fn); if (i >= 0) live.splice(i, 1); rem(t, fn, o); };
      target.__efWrapped = true;
    }
  })()`);
  // Blur is blocked while the widget goes away: Chrome blurs a removed focused input (which also closes the menu),
  // Safari need not — so the widget's own destroy() must release the listeners.
  const noBlur = (code) => `(() => { const stop = (e) => e.stopImmediatePropagation(); window.addEventListener("blur", stop, true); try { ${code}; } finally { setTimeout(() => window.removeEventListener("blur", stop, true), 0); } })()`;
  for (const [label, drop] of [["widget replaced", noBlur(`__ef.editor.setDoc("다른 문서")`)], ["editor destroyed", noBlur(`__ef.editor.destroy()`)]]) {
    await cdp.eval(`(() => { __ef.load("basic"); __ef.editor.setDoc(${JSON.stringify(DOC)}); })()`);
    await sleep(40);
    await tapElement(cdp, `.ef-table [data-row="1"][data-col="0"] .ef-cell-view`, "mouse");
    await tapElement(cdp, ".ef-table-handle", "mouse");
    await sleep(40);
    const opened = await cdp.eval(`__live.size`);
    await cdp.eval(drop);
    await sleep(40);
    const left = await cdp.eval(`__live.size`);
    if (!opened || left) { bad++; console.log(`FAIL table menu listeners (${label}): ${opened} registered, ${left} left`); }
  }
  await cdp.eval(`__ef.load("basic")`);
  if (problems.length > before) { bad++; for (const p of problems.slice(before)) console.log("  " + p); }
  console.log(`${bad ? "FAIL" : "PASS"} table menu (${cases.length} actions, mouse + touch; listeners released)`);
  return bad ? 1 : 0;
}

// 「열기 ↗」 under a coarse pointer (touch emulation): appears for a caret inside a note chip or link, a touch
// tap reaches onOpenNote / opens the URL without changing the text, and it goes away when the caret leaves.
async function openButtonCheck(cdp, problems) {
  const before = problems.length;
  let bad = 0;
  const fail = (msg) => { bad++; console.log("FAIL open button: " + msg); };
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  try {
    await cdp.eval(`(() => { window.__opened = []; window.open = (u) => { __opened.push(u); return null; }; __ef.load("worknote"); })()`);
    const doc = await cdp.eval("__ef.editor.getDoc()");
    for (const [label, pos, want] of [
      ["note chip", doc.indexOf("[[독서 메모") + 4, "노트 열기 요청"],
      ["link", doc.indexOf("https://example.com/notes") + 8, "https://example.com/notes"],
    ]) {
      await cdp.eval(`(() => { const v = __ef.editor.view; v.focus(); v.dispatch({ selection: { anchor: ${pos} } }); })()`);
      await sleep(80);
      if (!(await cdp.eval(`document.querySelectorAll(".ef-open").length === 1`))) { fail(`${label}: button not shown`); continue; }
      await tapElement(cdp, ".ef-open", "touch");
      await sleep(80);
      const r = await cdp.eval(`({ status: document.getElementById("status").textContent, opened: __opened.slice(), head: __ef.editor.view.state.selection.main.head, same: __ef.editor.getDoc() === __ef.SAMPLES.worknote.doc })`);
      if (!(r.status.includes(want) || r.opened.includes(want))) fail(`${label}: tap did not open (${JSON.stringify(r)})`);
      if (r.head !== pos) fail(`${label}: the tap moved the caret`);
      if (!r.same) fail(`${label}: the text changed`);
    }
    await cdp.eval(`__ef.editor.view.dispatch({ selection: { anchor: 0 } })`);
    await sleep(50);
    if (await cdp.eval(`document.querySelectorAll(".ef-open").length`)) fail("still shown after the caret left");
  } finally {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
  if (problems.length > before) { bad++; for (const p of problems.slice(before)) console.log("  " + p); }
  console.log(`${bad ? "FAIL" : "PASS"} open button (touch emulation: note chip + link)`);
  return bad ? 1 : 0;
}

// Paste with the browser's own DOMParser: Excel-like HTML + TSV into the body becomes one GFM table on its own
// lines (single undo step); plain text falls through to CodeMirror; a paste into a cell stays on one line.
async function pasteCheck(cdp, problems) {
  const before = problems.length;
  let bad = 0;
  const fail = (msg) => { bad++; console.log("FAIL paste: " + msg); };
  const paste = (target, html, text) => `(() => { const dt = new DataTransfer(); ${html != null ? `dt.setData("text/html", ${JSON.stringify(html)});` : ""} dt.setData("text/plain", ${JSON.stringify(text)});
    ${target}.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); })()`;
  const html = `<html><head><style>td{mso-number-format:General}</style></head><body><!--StartFragment--><table><tr><td>품목</td><td>수량</td></tr><tr><td rowspan=2>과일</td><td>3&nbsp;|&nbsp;4</td></tr><tr><td>5</td></tr><!--EndFragment--></table></body></html>`;
  await cdp.eval(`(() => { __ef.load("basic"); __ef.editor.setDoc("앞 문장 뒤"); const v = __ef.editor.view; v.focus(); v.dispatch({ selection: { anchor: 4 } }); })()`);
  await cdp.eval(paste("__ef.editor.view.contentDOM", html, "품목\t수량\n과일\t3 | 4\n\t5\n"));
  await sleep(60);
  let got = await cdp.eval("__ef.editor.getDoc()");
  const want = "앞 문장\n\n| 품목 | 수량 |\n| --- | --- |\n| 과일 | 3 \\| 4 |\n| 과일 | 5 |\n\n 뒤";
  if (got !== want) fail(`body HTML\n  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`);
  if (!(await cdp.eval(`document.querySelectorAll(".ef-table").length === 1`))) fail("the pasted table is not drawn as a table");
  await cdp.eval(`(() => { const v = __ef.editor.view; v.focus(); })()`);
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
  await sleep(60);
  if (await cdp.eval("__ef.editor.getDoc()") !== "앞 문장 뒤") fail("one undo did not remove the pasted table");

  await cdp.eval(`(() => { __ef.editor.setDoc("첫 줄"); const v = __ef.editor.view; v.focus(); v.dispatch({ selection: { anchor: 3 } }); })()`);
  await cdp.eval(paste("__ef.editor.view.contentDOM", null, "a\tb\n1\t2"));
  await sleep(60);
  got = await cdp.eval("__ef.editor.getDoc()");
  if (got !== "첫 줄\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n") fail("body TSV " + JSON.stringify(got));

  await cdp.eval(`(() => { __ef.editor.setDoc("글"); const v = __ef.editor.view; v.focus(); v.dispatch({ selection: { anchor: 1 } }); })()`);
  await cdp.eval(paste("__ef.editor.view.contentDOM", null, " 그냥 글"));
  await sleep(60);
  got = await cdp.eval("__ef.editor.getDoc()");
  if (got !== "글 그냥 글") fail("plain text did not fall through to the default paste " + JSON.stringify(got));

  await cdp.eval(`(() => { __ef.editor.setDoc("| 가 | 나 |\\n| --- | --- |\\n| 1 |  |"); })()`);
  await sleep(30);
  await tapElement(cdp, `.ef-table [data-row="1"][data-col="1"] .ef-cell-view`, "mouse");
  await cdp.eval(paste("document.activeElement", html, "x|y\tz\r\n둘째 줄\r\n"));
  await sleep(60);
  got = await cdp.eval("__ef.editor.getDoc()");
  if (got !== "| 가 | 나 |\n| --- | --- |\n| 1 | x\\|y z 둘째 줄 |") fail("cell paste " + JSON.stringify(got));

  // Real keyboard paste from the (headless) system clipboard: Ctrl+V converts TSV, Ctrl+Shift+V (paste as plain
  // text) keeps it as text, and a later Ctrl+V converts again (the plain-paste flag does not stick).
  const origin = await cdp.eval("location.origin");
  await cdp.send("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await cdp.eval(`(async () => { __ef.load("basic"); await navigator.clipboard.writeText("a\\tb\\n1\\t2"); })()`);
  const keyPaste = async (modifiers) => {
    await cdp.eval(`(() => { __ef.editor.setDoc("글"); const v = __ef.editor.view; v.focus(); v.dispatch({ selection: { anchor: 1 } }); })()`);
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: modifiers & 8 ? "V" : "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: modifiers & 8 ? "V" : "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers });
    await sleep(80);
    return cdp.eval("__ef.editor.getDoc()");
  };
  const TABLE = "글\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
  if ((got = await keyPaste(2)) !== TABLE) fail("Ctrl+V did not convert " + JSON.stringify(got));
  if ((got = await keyPaste(10)) !== "글a\tb\n1\t2") fail("Ctrl+Shift+V converted or lost the text " + JSON.stringify(got));
  if ((got = await keyPaste(2)) !== TABLE) fail("Ctrl+V after Ctrl+Shift+V did not convert " + JSON.stringify(got));

  // HTML with a paragraph around the table: the default paste keeps all of it (as plain text).
  await cdp.eval(`(() => { __ef.editor.setDoc(""); __ef.editor.view.focus(); })()`);
  await cdp.eval(paste("__ef.editor.view.contentDOM", "<p>앞 문단</p><table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table><p>뒤 문단</p>", "앞 문단\na\tb\n1\t2\n뒤 문단"));
  await sleep(60);
  got = await cdp.eval("__ef.editor.getDoc()");
  if (got !== "앞 문단\na\tb\n1\t2\n뒤 문단") fail("mixed HTML was converted " + JSON.stringify(got));

  if (problems.length > before) { bad++; for (const p of problems.slice(before)) console.log("  " + p); }
  console.log(`${bad ? "FAIL" : "PASS"} paste (HTML, TSV, plain text, inside a cell, Ctrl+Shift+V, mixed HTML)`);
  return bad ? 1 : 0;
}

// Format keys through the real keyboard path: Ctrl+B and Ctrl+Shift+X wrap a selection, a second press unwraps.
async function formatKeysCheck(cdp, problems) {
  const before = problems.length;
  let bad = 0;
  const fail = (msg) => { bad++; console.log("FAIL format keys: " + msg); };
  const press = async (key, code, vk, modifiers) => {
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(60);
    return cdp.eval("__ef.editor.getDoc()");
  };
  const select = (doc, a, h) => cdp.eval(`(() => { __ef.load("basic"); __ef.editor.setDoc(${JSON.stringify(doc)}); const v = __ef.editor.view; v.focus(); v.dispatch({ selection: { anchor: ${a}, head: ${h} } }); })()`);
  let got;
  await select("지난 일정 정리", 0, 5);
  if ((got = await press("X", "KeyX", 88, 10)) !== "~~지난 일정~~ 정리") fail("Ctrl+Shift+X did not wrap " + JSON.stringify(got));
  if ((got = await press("X", "KeyX", 88, 10)) !== "지난 일정 정리") fail("second Ctrl+Shift+X did not unwrap " + JSON.stringify(got));
  await cdp.eval(`__ef.editor.view.dispatch({ selection: { anchor: 0, head: 5 } })`);
  await press("X", "KeyX", 88, 10);
  await cdp.eval(`__ef.editor.view.dispatch({ selection: { anchor: __ef.editor.view.state.doc.length } })`);
  await sleep(500);
  if (!(await cdp.eval(`!!document.querySelector(".ef-strike") && !__ef.editor.view.contentDOM.textContent.includes("~~")`))) fail("strikethrough is not drawn (or ~~ is visible)");
  await select("가나다", 0, 3);
  if ((got = await press("b", "KeyB", 66, 2)) !== "**가나다**") fail("Ctrl+B did not wrap " + JSON.stringify(got));
  if (problems.length > before) { bad++; for (const p of problems.slice(before)) console.log("  " + p); }
  console.log(`${bad ? "FAIL" : "PASS"} format keys (Ctrl+Shift+X strike on/off and drawn, Ctrl+B)`);
  return bad ? 1 : 0;
}

async function main() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(join(root, "traces")).filter((f) => f.endsWith(".json")).map((f) => join(root, "traces", f));
  const lab = await openLab();
  const { cdp, problems } = lab;
  let failed = 0;
  try {
    // Rendered text outside code blocks must show no raw syntax (caret is at the end, touching nothing).
    const info = await cdp.eval(`(() => {
      const lines = [...__ef.editor.view.contentDOM.querySelectorAll(".cm-line:not(.ef-codeblock)")].map((l) => l.textContent).join(" ");
      const raw = ["**", "- [", "](", "<u>", "~~", "| ---", "## "].filter((m) => lines.includes(m));
      return { tables: document.querySelectorAll(".ef-table").length, boxes: document.querySelectorAll(".ef-box").length,
        same: __ef.editor.getDoc() === __ef.SAMPLES.basic.doc, raw };
    })()`);
    console.log(`lab: tables=${info.tables} checkboxes=${info.boxes} roundTrip=${info.same} rawSyntaxVisible=${JSON.stringify(info.raw)} errors=${problems.length}`);
    if (!info.same || !info.tables || info.raw.length || problems.length) { failed++; for (const p of problems) console.log("  " + p); }
    failed += await tableMenuCheck(cdp, problems);
    failed += await openButtonCheck(cdp, problems);
    failed += await pasteCheck(cdp, problems);
    failed += await formatKeysCheck(cdp, problems);

    for (const file of files) {
      const t = JSON.parse(readFileSync(file, "utf8"));
      await cdp.eval(`(() => {
        __ef.load(${JSON.stringify(t.sample || "basic")});
        __ef.editor.setDoc(${JSON.stringify(t.setup.doc)});
        const v = __ef.editor.view;
        const head = ${JSON.stringify(t.setup.head ?? "end")};
        v.focus();
        v.dispatch({ selection: { anchor: head === "end" ? v.state.doc.length : head } });
      })()`);
      await sleep(50);
      const before = problems.length;
      let err = null;
      try {
        for (const s of t.steps) { await runStep(cdp, s); await sleep(s.op === "wait" ? 0 : 40); }
      } catch (e) { err = e; }
      await sleep(HOT_IDLE_MS);
      const got = await cdp.eval("__ef.editor.getDoc()");
      const ok = !err && got === t.expect && problems.length === before;
      if (!ok) failed++;
      console.log(`${ok ? "PASS" : "FAIL"} ${t.name}`);
      if (!ok) {
        if (err) console.log("  step error: " + err.message);
        if (got !== t.expect) console.log(`  expected ${JSON.stringify(t.expect)}\n  got      ${JSON.stringify(got)}`);
        for (const p of problems.slice(before)) console.log("  " + p);
      }
    }
  } finally {
    await lab.close();
  }
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
