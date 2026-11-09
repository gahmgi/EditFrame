// Replay input traces against the built editor in headless Chrome (CDP), and smoke-test the lab.
//
//   node scripts/replay-traces.mjs                 all traces in traces/
//   node scripts/replay-traces.mjs traces/x.json   one trace
//   CHROME_PATH=... node scripts/replay-traces.mjs
//
// 1. Starts scripts/serve.mjs on a free port, launches headless Chrome with a throwaway profile.
// 2. Opens /lab/ (which imports dist/editframe.mjs) and fails on any console error or uncaught exception.
// 3. For each trace: loads setup.doc, places the caret, runs the steps through real input paths, waits for
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
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOT_IDLE_MS = 700; // > HOT_MS (400) in src/core/preview.js, so the deferred recompute has run

function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].filter(Boolean);
  return c.find((p) => existsSync(p));
}
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() > end) throw new Error("timeout");
    await sleep(100);
  }
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; ws.addEventListener("message", (m) => this.onMessage(JSON.parse(m.data))); }
  onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) { const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else for (const l of this.listeners) l(msg);
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

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

async function main() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(join(root, "traces")).filter((f) => f.endsWith(".json")).map((f) => join(root, "traces", f));
  const chrome = findChrome();
  if (!chrome) { console.error("Chrome/Edge not found — set CHROME_PATH"); process.exit(2); }
  if (!existsSync(join(root, "dist/editframe.mjs"))) { console.error("dist/editframe.mjs missing — run npm run build"); process.exit(2); }

  const httpPort = await freePort(), cdpPort = await freePort();
  const server = spawn(process.execPath, [join(root, "scripts/serve.mjs"), "--port", String(httpPort)], { stdio: "ignore" });
  const profile = mkdtempSync(join(tmpdir(), "editframe-cdp-"));
  const browser = spawn(chrome, ["--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let failed = 0;
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok);
    const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const cdp = new Cdp(ws);
    const problems = [];
    cdp.listeners.push((m) => {
      if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") problems.push("log: " + m.params.entry.text + " " + (m.params.entry.url || ""));
    });
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${httpPort}/lab/` });
    await waitFor(() => cdp.eval("!!window.__ef"));
    // Rendered text outside code blocks must show no raw syntax (caret is at the end, touching nothing).
    const info = await cdp.eval(`(() => {
      const lines = [...__ef.editor.view.contentDOM.querySelectorAll(".cm-line:not(.ef-codeblock)")].map((l) => l.textContent).join(" ");
      const raw = ["**", "- [", "](", "<u>", "~~", "| ---", "## "].filter((m) => lines.includes(m));
      return { tables: document.querySelectorAll(".ef-table").length, boxes: document.querySelectorAll(".ef-box").length,
        same: __ef.editor.getDoc() === __ef.SAMPLES.basic.doc, raw };
    })()`);
    console.log(`lab: tables=${info.tables} checkboxes=${info.boxes} roundTrip=${info.same} rawSyntaxVisible=${JSON.stringify(info.raw)} errors=${problems.length}`);
    if (!info.same || !info.tables || info.raw.length || problems.length) { failed++; for (const p of problems) console.log("  " + p); }

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
    ws.close();
  } finally {
    browser.kill();
    server.kill();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
