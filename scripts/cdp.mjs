// Headless Chrome for the lab, over the DevTools protocol (CDP). Shared by replay-traces.mjs and bench.mjs.
//
//   const lab = await openLab();   // serve.mjs on a free port + headless Chrome with a throwaway profile,
//                                  // /lab/ loaded (it imports dist/editframe.mjs)
//   await lab.cdp.eval("…");       // run code in the page
//   lab.problems                   // console errors, uncaught exceptions, failed loads seen so far
//   await lab.close();             // stops exactly the two processes it started (by handle, never by name)
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

export const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].filter(Boolean);
  return c.find((p) => existsSync(p));
}
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

export async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch {}
    if (Date.now() > end) throw new Error("timeout");
    await sleep(100);
  }
}

export class Cdp {
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

export async function openLab() {
  const chrome = findChrome();
  if (!chrome) { console.error("Chrome/Edge not found — set CHROME_PATH"); process.exit(2); }
  if (!existsSync(join(root, "dist/editframe.mjs"))) { console.error("dist/editframe.mjs missing — run npm run build"); process.exit(2); }
  const httpPort = await freePort(), cdpPort = await freePort();
  const server = spawn(process.execPath, [join(root, "scripts/serve.mjs"), "--port", String(httpPort)], { stdio: "ignore" });
  const profile = mkdtempSync(join(tmpdir(), "editframe-cdp-"));
  const browser = spawn(chrome, ["--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let ws = null;
  const close = async () => {
    try { ws?.close(); } catch {}
    browser.kill();
    server.kill();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok);
    const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
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
    return { cdp, problems, close };
  } catch (e) {
    await close();
    throw e;
  }
}
